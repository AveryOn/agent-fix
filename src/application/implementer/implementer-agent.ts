import type {
  ImplementationArtifactStore,
  ImplementationInput,
  ImplementationModelPlan,
  ImplementationPlan,
  ImplementationResult,
  ImplementerAgent
} from '~/core/implementation'
import type { Logger } from '~/core/logging'
import type { ModelProvider, ModelResult } from '~/core/model'
import type {
  ProcessOperationResult,
  ProcessRunnerFactory
} from '~/core/process'
import type {
  PromptRegistry,
  PromptVersionIdentifier
} from '~/core/prompt'
import type { TraceRecorder } from '~/core/trace'
import type {
  RepositoryTools,
  RepositoryToolsFactory,
  WorkspaceSnapshot
} from '~/core/workspace'

import { z } from 'zod'
import { ImplementationGate } from '~/application/implementer/implementation-gate'
import { ImplementationPatchValidator } from '~/application/implementer/implementation-patch-validator'
import { AgentRole } from '~/core/context'
import {
  ImplementerError,
  ImplementerErrorCode,
  implementationInputSchema,
  implementationModelPlanSchema
} from '~/core/implementation'
import { TraceEventType } from '~/core/trace'

const implementerStep = 'implementer'

export class ModelImplementerAgent implements ImplementerAgent {
  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly promptRegistry: PromptRegistry,
    private readonly repositoryToolsFactory: RepositoryToolsFactory,
    private readonly processRunnerFactory: ProcessRunnerFactory,
    private readonly artifactStore: ImplementationArtifactStore,
    private readonly traceRecorder: TraceRecorder,
    private readonly logger: Logger,
    private readonly patchValidator = new ImplementationPatchValidator(),
    private readonly implementationGate = new ImplementationGate()
  ) {}

  async execute(
    input: ImplementationInput
  ): Promise<ImplementationResult> {
    this.assertValidInput(input)

    const sourceWorkspaceRevision = input.context.context.workspaceRevision

    const logger = this.logger.child({
      runId: input.context.context.runId,
      step: implementerStep,
      agent: AgentRole.implementer,
      workspaceRevision: sourceWorkspaceRevision
    })

    let promptVersion: PromptVersionIdentifier | undefined

    try {
      const prompt = await this.promptRegistry.load(AgentRole.implementer)

      promptVersion = prompt.id

      const repositoryTools = this.repositoryToolsFactory.create(
        input.workspace
      )

      await this.assertFreshWorkspace(
        repositoryTools,
        sourceWorkspaceRevision
      )

      const sourceFiles = await Promise.all(
        [
          ...new Set(input.evidence.map((evidence) => evidence.filePath))
        ].map(async (filePath) => {
          const file = await repositoryTools.readFile(filePath)

          return {
            path: file.path,
            content: file.content
          }
        })
      )

      const modelResult = await this.modelProvider.generate({
        input: [
          {
            type: 'message',
            role: 'system',
            content: prompt.content
          },
          {
            type: 'message',
            role: 'user',
            content: JSON.stringify({
              context: {
                runId: input.context.context.runId,
                task: input.context.context.task,
                workspaceRevision: sourceWorkspaceRevision,
                constraints: input.context.context.constraints
              },

              currentSourceFiles: sourceFiles,

              failingTest: {
                testFiles: input.reproduction.testFiles,
                expectedFailureMarker:
                  input.reproduction.expectedFailureMarker,
                workspaceRevision: input.reproduction.workspaceRevision,
                commandResult: input.reproduction.commandResult
              },

              allowedFileScope: input.allowedFileScope
            })
          }
        ],
        outputSchemaName: 'implementation_model_plan',
        outputSchema: implementationModelPlanSchema
      })

      await this.recordModelCall(input, prompt.id, modelResult)

      if (modelResult.toolCalls.length > 0) {
        throw new ImplementerError(
          'Implementer returned an unexpected tool call',
          ImplementerErrorCode.unexpected_tool_call
        )
      }

      if (modelResult.output === undefined) {
        throw new ImplementerError(
          'Implementer returned no structured output',
          ImplementerErrorCode.missing_output,
          {
            retryable: true
          }
        )
      }

      const parsedPlan = this.parsePlan(modelResult.output)

      const patch = buildImplementationPatch(sourceFiles, parsedPlan)

      const plan: ImplementationPlan = {
        summary: parsedPlan.summary,
        patch,
        changedFiles: parsedPlan.changedFiles,
        risks: parsedPlan.risks,
        workspaceRevision: parsedPlan.workspaceRevision
      }

      logger.info('Implementer generated patch', {
        patch: plan.patch,
        changedFiles: plan.changedFiles,
        summary: plan.summary
      })

      const expectedChangedFiles = this.patchValidator.validate(
        plan,
        input.allowedFileScope,
        input.reproduction,
        sourceWorkspaceRevision
      )

      await this.assertFreshWorkspace(
        repositoryTools,
        sourceWorkspaceRevision
      )

      let patchApplied = false

      const applyResult = await this.applyPatch(
        input,
        prompt.id,
        repositoryTools,
        plan
      )

      patchApplied = true

      try {
        const reproductionTestFiles = new Set(input.reproduction.testFiles)

        const implementationChangedFiles = applyResult.changedFiles.filter(
          (filePath) => !reproductionTestFiles.has(filePath)
        )

        assertChangedFilesMatch(
          expectedChangedFiles,
          implementationChangedFiles
        )

        const patchedWorkspace: WorkspaceSnapshot = {
          ...input.workspace,
          workspaceRevision: applyResult.workspaceRevision
        }

        const processRunner =
          this.processRunnerFactory.create(patchedWorkspace)

        const commandResult = await this.runTests(
          input,
          prompt.id,
          processRunner.runTests.bind(processRunner),
          applyResult.workspaceRevision
        )

        this.implementationGate.assertReproductionFixed(
          commandResult,
          input.reproduction.expectedFailureMarker
        )

        const artifacts = await this.artifactStore.save({
          runId: input.context.context.runId,
          plan,
          sourceWorkspaceRevision,
          workspaceRevision: applyResult.workspaceRevision,
          reproduction: input.reproduction,
          commandResult
        })

        const result: ImplementationResult = {
          summary: plan.summary,
          patch: plan.patch,
          changedFiles: plan.changedFiles,
          risks: plan.risks,
          sourceWorkspaceRevision,
          workspaceRevision: applyResult.workspaceRevision,
          commandResult,
          artifacts
        }

        await this.traceRecorder.record({
          runId: input.context.context.runId,
          step: implementerStep,
          agent: AgentRole.implementer,
          workspaceRevision: result.workspaceRevision,
          type: TraceEventType.agent_result,
          promptVersion: prompt.id,
          output: {
            summary: result.summary,
            changedFiles: result.changedFiles,
            risks: result.risks,
            implementationArtifact: result.artifacts.implementation,
            patchArtifact: result.artifacts.patch,
            commandArtifact: result.artifacts.command
          }
        })

        logger.info('Implementation completed', {
          changedFiles: result.changedFiles,
          commandExecutionId: commandResult.executionId
        })

        patchApplied = false

        return result
      } catch (error) {
        if (patchApplied) {
          try {
            await repositoryTools.revertPatch(plan.patch)

            logger.info('Reverted failed implementation patch', {
              changedFiles: plan.changedFiles
            })
          } catch (rollbackError) {
            logger.error('Failed to revert implementation patch', {
              rollbackError
            })

            throw new ImplementerError(
              'Implementation failed and rollback also failed',
              ImplementerErrorCode.patch_application_failed,
              {
                retryable: false,
                cause: rollbackError
              }
            )
          }
        }

        throw error
      }
    } catch (error) {
      await this.recordFailure(input, promptVersion, error, logger)

      logger.error('Implementation failed', {
        error
      })

      throw error
    }
  }

  private assertValidInput(input: ImplementationInput): void {
    const result = implementationInputSchema.safeParse(input)

    if (!result.success) {
      throw new ImplementerError(
        'Implementation input failed schema validation: ' +
          z.prettifyError(result.error),
        ImplementerErrorCode.invalid_input,
        {
          cause: result.error
        }
      )
    }
  }

  private parsePlan(value: unknown): ImplementationModelPlan {
    const result = implementationModelPlanSchema.safeParse(value)

    if (!result.success) {
      throw new ImplementerError(
        'Implementation output failed schema validation: ' +
          z.prettifyError(result.error),
        ImplementerErrorCode.invalid_output,
        {
          retryable: true,
          cause: result.error
        }
      )
    }

    return result.data
  }

  private async assertFreshWorkspace(
    repositoryTools: RepositoryTools,
    expectedRevision: string
  ): Promise<void> {
    const currentRevision = await repositoryTools.getWorkspaceRevision()

    if (currentRevision !== expectedRevision) {
      throw new ImplementerError(
        'Implementer context contains a stale workspace revision',
        ImplementerErrorCode.stale_workspace,
        {
          retryable: true
        }
      )
    }
  }

  private async applyPatch(
    input: ImplementationInput,
    promptVersion: PromptVersionIdentifier,
    repositoryTools: RepositoryTools,
    plan: ImplementationPlan
  ) {
    await this.traceRecorder.record({
      runId: input.context.context.runId,
      step: implementerStep,
      agent: AgentRole.implementer,
      workspaceRevision: input.workspace.workspaceRevision,
      type: TraceEventType.tool_call,
      promptVersion,
      input: {
        name: 'applyImplementationPatch',
        changedFiles: plan.changedFiles
      }
    })

    try {
      const result = await repositoryTools.applyPatch(plan.patch)

      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: implementerStep,
        agent: AgentRole.implementer,
        workspaceRevision: result.workspaceRevision,
        type: TraceEventType.tool_result,
        promptVersion,
        output: {
          name: 'applyImplementationPatch',
          changedFiles: result.changedFiles,
          workspaceRevision: result.workspaceRevision
        }
      })

      return result
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : 'Unknown patch application error'

      throw new ImplementerError(
        `Failed to apply implementation patch: ${reason}`,
        ImplementerErrorCode.patch_application_failed,
        {
          retryable: true,
          cause: error
        }
      )
    }
  }

  private async runTests(
    input: ImplementationInput,
    promptVersion: PromptVersionIdentifier,
    runTests: () => Promise<ProcessOperationResult>,
    workspaceRevision: string
  ): Promise<ProcessOperationResult> {
    await this.traceRecorder.record({
      runId: input.context.context.runId,
      step: implementerStep,
      agent: AgentRole.implementer,
      workspaceRevision,
      type: TraceEventType.tool_call,
      promptVersion,
      input: {
        name: 'runTests'
      }
    })

    const result = await runTests()

    await this.traceRecorder.record({
      runId: input.context.context.runId,
      step: implementerStep,
      agent: AgentRole.implementer,
      workspaceRevision,
      type: TraceEventType.tool_result,
      promptVersion,
      durationMs: result.durationMs,
      output: {
        name: 'runTests',
        executionId: result.executionId,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        succeeded: result.succeeded,
        artifact: result.artifact
      }
    })

    return result
  }

  private recordModelCall(
    input: ImplementationInput,
    promptVersion: PromptVersionIdentifier,
    result: ModelResult<ImplementationModelPlan>
  ): Promise<void> {
    return this.traceRecorder.record({
      runId: input.context.context.runId,
      step: implementerStep,
      agent: AgentRole.implementer,
      workspaceRevision: input.workspace.workspaceRevision,
      type: TraceEventType.agent_call,
      promptVersion,
      durationMs: result.durationMs,
      tokenUsage: result.usage,
      output: {
        returnedStructuredOutput: result.output !== undefined,
        toolCalls: result.toolCalls.map((toolCall) => toolCall.name)
      }
    })
  }

  private async recordFailure(
    input: ImplementationInput,
    promptVersion: PromptVersionIdentifier | undefined,
    error: unknown,
    logger: Logger
  ): Promise<void> {
    try {
      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: implementerStep,
        agent: AgentRole.implementer,
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
      logger.warn('Failed to record implementer failure', {
        traceError
      })
    }
  }
}

interface CurrentSourceFile {
  readonly path: string
  readonly content: string
}

function buildImplementationPatch(
  sourceFiles: readonly CurrentSourceFile[],
  plan: ImplementationModelPlan
): string {
  const sourceFilesByPath = new Map(
    sourceFiles.map((file) => [file.path, file.content])
  )

  const patches: string[] = []

  for (const changedFile of plan.files) {
    const currentContent = sourceFilesByPath.get(changedFile.path)

    if (currentContent === undefined) {
      throw new ImplementerError(
        `Implementation changed a file that was not supplied in currentSourceFiles: ${changedFile.path}`,
        ImplementerErrorCode.invalid_output,
        {
          retryable: true
        }
      )
    }

    if (currentContent === changedFile.content) {
      throw new ImplementerError(
        `Implementation returned unchanged content for ${changedFile.path}`,
        ImplementerErrorCode.invalid_output,
        {
          retryable: true
        }
      )
    }

    patches.push(
      buildWholeFilePatch(
        changedFile.path,
        currentContent,
        changedFile.content
      )
    )
  }

  return `${patches.join('\n')}\n`
}

function buildWholeFilePatch(
  filePath: string,
  currentContent: string,
  nextContent: string
): string {
  const oldLines = splitFileLines(currentContent)

  const newLines = splitFileLines(nextContent)

  const oldCount = oldLines.length
  const newCount = newLines.length

  const oldStart = oldCount === 0 ? 0 : 1
  const newStart = newCount === 0 ? 0 : 1

  const lines = [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`)
  ]

  if (currentContent.length > 0 && !currentContent.endsWith('\n')) {
    const oldLastLineIndex = 4 + oldLines.length - 1

    lines.splice(oldLastLineIndex + 1, 0, '\\ No newline at end of file')
  }

  if (nextContent.length > 0 && !nextContent.endsWith('\n')) {
    lines.push('\\ No newline at end of file')
  }

  return lines.join('\n')
}

function splitFileLines(content: string): string[] {
  if (content.length === 0) {
    return []
  }

  const normalized = content.replaceAll('\r\n', '\n')

  const lines = normalized.split('\n')

  if (normalized.endsWith('\n')) {
    lines.pop()
  }

  return lines
}

function assertChangedFilesMatch(
  expectedFiles: readonly string[],
  actualFiles: readonly string[]
): void {
  const expected = [...expectedFiles].sort()

  const actual = [...actualFiles].sort()

  if (expected.length !== actual.length) {
    throw new ImplementerError(
      'Applied implementation patch changed unexpected files',
      ImplementerErrorCode.changed_files_mismatch
    )
  }

  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] !== actual[index]) {
      throw new ImplementerError(
        'Applied implementation patch changed unexpected files',
        ImplementerErrorCode.changed_files_mismatch
      )
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
      message: 'Unknown implementer failure'
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
