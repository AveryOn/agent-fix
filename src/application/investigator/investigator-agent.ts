import type {
  InvestigationInput,
  InvestigationResult,
  InvestigatorAgent
} from '~/core/investigation'
import type { Logger } from '~/core/logging'
import type {
  ModelInput,
  ModelProvider,
  ModelResult,
  ModelToolResult
} from '~/core/model'
import type {
  PromptRegistry,
  PromptVersionIdentifier
} from '~/core/prompt'
import type { TraceRecorder } from '~/core/trace'
import type {
  RepositoryTools,
  RepositoryToolsFactory
} from '~/core/workspace'

import { z } from 'zod'
import { InvestigationValidator } from '~/application/investigator/investigation-validator'
import { InvestigatorRepositoryTools } from '~/application/investigator/investigator-tools'
import { AgentRole } from '~/core/context'
import {
  InvestigatorError,
  InvestigatorErrorCode,
  investigationInputSchema,
  investigationResultSchema
} from '~/core/investigation'
import { TraceEventType } from '~/core/trace'

const investigatorStep = 'investigator'
const maximumInteractiveToolIterations = 12

export interface ModelInvestigatorAgentOptions {
  readonly maximumToolIterations?: number
}

export class ModelInvestigatorAgent implements InvestigatorAgent {
  private readonly maximumToolIterations: number

  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly promptRegistry: PromptRegistry,
    private readonly repositoryToolsFactory: RepositoryToolsFactory,
    private readonly traceRecorder: TraceRecorder,
    private readonly logger: Logger,
    private readonly validator = new InvestigationValidator(),
    options: ModelInvestigatorAgentOptions = {}
  ) {
    const maximumToolIterations = options.maximumToolIterations ?? 20

    if (
      !Number.isInteger(maximumToolIterations) ||
      maximumToolIterations <= 0
    ) {
      throw new Error('maximumToolIterations must be a positive integer')
    }

    this.maximumToolIterations = maximumToolIterations
  }

  async execute(input: InvestigationInput): Promise<InvestigationResult> {
    this.assertValidInput(input)

    const expectedWorkspaceRevision =
      input.context.context.workspaceRevision

    const logger = this.logger.child({
      runId: input.context.context.runId,
      step: investigatorStep,
      agent: AgentRole.investigator,
      workspaceRevision: expectedWorkspaceRevision
    })

    let promptVersion: PromptVersionIdentifier | undefined

    try {
      const prompt = await this.promptRegistry.load(AgentRole.investigator)

      promptVersion = prompt.id

      const repositoryTools = this.repositoryToolsFactory.create(
        input.workspace
      )

      await this.assertInitialWorkspaceRevision(
        expectedWorkspaceRevision,
        repositoryTools
      )

      const investigatorTools = new InvestigatorRepositoryTools(
        repositoryTools
      )

      let modelInput: readonly ModelInput[] = [
        {
          type: 'message',
          role: 'system',
          content: prompt.content
        },
        {
          type: 'message',
          role: 'user',
          content: JSON.stringify({
            agentContext: input.context.context
          })
        }
      ]

      let previousResponseId: string | undefined

      for (
        let iteration = 1;
        iteration <= this.maximumToolIterations;
        iteration += 1
      ) {
        const tools =
          iteration <= maximumInteractiveToolIterations
            ? investigatorTools.definitions
            : []
        const modelResult = await this.modelProvider.generate({
          input: modelInput,
          outputSchemaName: 'investigation_result',
          outputSchema: investigationResultSchema,
          tools,

          ...(previousResponseId === undefined
            ? {}
            : {
                previousResponseId
              })
        })

        await this.recordModelCall(
          input,
          prompt.id,
          iteration,
          modelResult
        )

        if (modelResult.toolCalls.length > 0) {
          if (modelResult.responseId === undefined) {
            throw new InvestigatorError(
              'Model returned tool calls without a response identifier',
              InvestigatorErrorCode.missing_response_id,
              {
                retryable: true
              }
            )
          }

          modelInput = await this.executeToolCalls(
            input,
            prompt.id,
            investigatorTools,
            modelResult.toolCalls
          )

          previousResponseId = modelResult.responseId

          continue
        }

        if (modelResult.output === undefined) {
          throw new InvestigatorError(
            'Investigator returned no structured output',
            InvestigatorErrorCode.missing_output,
            {
              retryable: true
            }
          )
        }

        const investigation = await this.validator.validate(
          modelResult.output,
          expectedWorkspaceRevision,
          repositoryTools
        )

        await this.traceRecorder.record({
          runId: input.context.context.runId,
          step: investigatorStep,
          agent: AgentRole.investigator,
          workspaceRevision: expectedWorkspaceRevision,
          type: TraceEventType.agent_result,
          promptVersion: prompt.id,
          output: investigation
        })

        logger.info('Investigation completed', {
          evidenceCount: investigation.evidence.length,
          relatedFileCount: investigation.relatedFiles.length
        })

        return investigation
      }

      throw new InvestigatorError(
        `Investigator exceeded ${this.maximumToolIterations} ` +
          'tool iterations',
        InvestigatorErrorCode.tool_loop_exhausted,
        {
          retryable: true
        }
      )
    } catch (error) {
      await this.recordFailure(input, promptVersion, error, logger)

      logger.error('Investigation failed', {
        error
      })

      throw error
    }
  }

  private assertValidInput(input: InvestigationInput): void {
    const result = investigationInputSchema.safeParse(input)

    if (!result.success) {
      throw new InvestigatorError(
        'Investigation input failed schema validation: ' +
          z.prettifyError(result.error),
        InvestigatorErrorCode.invalid_input,
        {
          cause: result.error
        }
      )
    }
  }

  private async assertInitialWorkspaceRevision(
    expectedRevision: string,
    repositoryTools: RepositoryTools
  ): Promise<void> {
    const currentRevision = await repositoryTools.getWorkspaceRevision()

    if (currentRevision !== expectedRevision) {
      throw new InvestigatorError(
        'Investigator context contains a stale workspace revision',
        InvestigatorErrorCode.stale_workspace,
        {
          retryable: true
        }
      )
    }
  }
  private async executeToolCalls(
    input: InvestigationInput,
    promptVersion: PromptVersionIdentifier,
    tools: InvestigatorRepositoryTools,
    toolCalls: ModelResult<InvestigationResult>['toolCalls']
  ): Promise<readonly ModelToolResult[]> {
    const toolResults: ModelToolResult[] = []

    for (const toolCall of toolCalls) {
      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: investigatorStep,
        agent: AgentRole.investigator,
        workspaceRevision: input.context.context.workspaceRevision,
        type: TraceEventType.tool_call,
        promptVersion,
        input: {
          callId: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments
        }
      })

      try {
        const toolResult = await tools.execute(toolCall)

        await this.traceRecorder.record({
          runId: input.context.context.runId,
          step: investigatorStep,
          agent: AgentRole.investigator,
          workspaceRevision: input.context.context.workspaceRevision,
          type: TraceEventType.tool_result,
          promptVersion,
          output: {
            callId: toolCall.id,
            name: toolCall.name,
            result: toolResult.traceOutput
          }
        })

        toolResults.push({
          type: 'tool_result',
          callId: toolCall.id,
          output: toolResult.modelOutput
        })
      } catch (error) {
        if (!(error instanceof InvestigatorError && error.retryable)) {
          throw error
        }

        const toolError = {
          error: {
            code: error.code,
            message: error.message,
            retryable: true
          }
        }

        await this.traceRecorder.record({
          runId: input.context.context.runId,
          step: investigatorStep,
          agent: AgentRole.investigator,
          workspaceRevision: input.context.context.workspaceRevision,
          type: TraceEventType.tool_result,
          promptVersion,
          output: {
            callId: toolCall.id,
            name: toolCall.name,
            result: toolError
          }
        })

        toolResults.push({
          type: 'tool_result',
          callId: toolCall.id,
          output: JSON.stringify(toolError)
        })
      }
    }

    return toolResults
  }

  private recordModelCall(
    input: InvestigationInput,
    promptVersion: PromptVersionIdentifier,
    iteration: number,
    result: ModelResult<InvestigationResult>
  ): Promise<void> {
    return this.traceRecorder.record({
      runId: input.context.context.runId,
      step: investigatorStep,
      agent: AgentRole.investigator,
      workspaceRevision: input.context.context.workspaceRevision,
      type: TraceEventType.agent_call,
      promptVersion,
      durationMs: result.durationMs,
      tokenUsage: result.usage,
      input: {
        iteration
      },
      output: {
        returnedStructuredOutput: result.output !== undefined,

        toolCalls: result.toolCalls.map((toolCall) => toolCall.name)
      }
    })
  }

  private async recordFailure(
    input: InvestigationInput,
    promptVersion: PromptVersionIdentifier | undefined,
    error: unknown,
    logger: Logger
  ): Promise<void> {
    try {
      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: investigatorStep,
        agent: AgentRole.investigator,
        workspaceRevision: input.context.context.workspaceRevision,
        type: TraceEventType.failure,
        error: toTraceError(error),

        ...(promptVersion === undefined
          ? {}
          : {
              promptVersion
            })
      })
    } catch (traceError) {
      logger.warn('Failed to record investigator failure', {
        traceError
      })
    }
  }
}

function toTraceError(error: unknown): {
  name: string
  message: string
  code?: string
  retryable?: boolean
} {
  if (!(error instanceof Error)) {
    return {
      name: 'UnknownError',
      message: 'Unknown investigator failure'
    }
  }

  const result: {
    name: string
    message: string
    code?: string
    retryable?: boolean
  } = {
    name: error.name,
    message: error.message
  }

  if ('code' in error && typeof error.code === 'string') {
    result.code = error.code
  }

  if ('retryable' in error && typeof error.retryable === 'boolean') {
    result.retryable = error.retryable
  }

  return result
}
