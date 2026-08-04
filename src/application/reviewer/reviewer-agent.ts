import type { Logger } from '~/core/logging'
import type { ModelProvider, ModelResult } from '~/core/model'
import type {
  PromptRegistry,
  PromptVersionIdentifier
} from '~/core/prompt'
import type {
  ReviewArtifactStore,
  ReviewDecision,
  ReviewerAgent,
  ReviewInput,
  ReviewResult
} from '~/core/review'
import type { TraceRecorder } from '~/core/trace'

import { z } from 'zod'
import { FinalDiffAnalyzer } from '~/application/reviewer/final-diff-analyzer'
import { ReviewResultValidator } from '~/application/reviewer/review-result-validator'
import { AgentOutputSchemaValidator } from '~/application/validation'
import { AgentRole } from '~/core/context'
import {
  reviewDecisionSchema,
  reviewInputSchema,
  ReviewerError,
  ReviewerErrorCode
} from '~/core/review'
import { TraceEventType } from '~/core/trace'

const reviewerStep = 'reviewer'

export class ModelReviewerAgent implements ReviewerAgent {
  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly promptRegistry: PromptRegistry,
    private readonly artifactStore: ReviewArtifactStore,
    private readonly traceRecorder: TraceRecorder,
    private readonly logger: Logger,
    private readonly diffAnalyzer = new FinalDiffAnalyzer(),
    private readonly resultValidator = new ReviewResultValidator(),
    private readonly agentOutputValidator = new AgentOutputSchemaValidator()
  ) {}

  async execute(input: ReviewInput): Promise<ReviewResult> {
    this.assertValidInput(input)

    const workspaceRevision = input.context.context.workspaceRevision

    const logger = this.logger.child({
      runId: input.context.context.runId,
      step: reviewerStep,
      agent: AgentRole.reviewer,
      workspaceRevision
    })

    let promptVersion: PromptVersionIdentifier | undefined

    try {
      const prompt = await this.promptRegistry.load(AgentRole.reviewer)

      promptVersion = prompt.id

      const diffAnalysis = this.diffAnalyzer.analyze(input.finalDiff)

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

                workspaceRevision,

                constraints: input.context.context.constraints
              },

              changedFiles: input.changedFiles,

              finalDiff: input.finalDiff,

              mechanicalValidation: input.validationReport,

              diffSummary: {
                files: diffAnalysis.files.map((file) => ({
                  path: file.path,
                  addedLines: file.addedLines,
                  deletedLines: file.deletedLines
                })),

                totalAddedLines: diffAnalysis.totalAddedLines,

                totalDeletedLines: diffAnalysis.totalDeletedLines,

                excessive: diffAnalysis.excessive,

                signals: diffAnalysis.signals
              }
            })
          }
        ],

        outputSchemaName: 'review_decision',

        outputSchema: reviewDecisionSchema
      })

      await this.recordModelCall(input, prompt.id, modelResult)

      if (modelResult.toolCalls.length > 0) {
        throw new ReviewerError(
          'Reviewer returned an unexpected tool call',
          ReviewerErrorCode.unexpected_tool_call
        )
      }

      if (modelResult.output === undefined) {
        throw new ReviewerError(
          'Reviewer returned no structured output',
          ReviewerErrorCode.missing_output,
          {
            retryable: true
          }
        )
      }

      const decision = this.agentOutputValidator.validateReview(
        modelResult.output
      )

      const validatedDecision = this.resultValidator.validate(
        decision,
        input,
        diffAnalysis
      )

      const artifact = await this.saveArtifact(
        input,
        prompt.id,
        validatedDecision
      )

      const result: ReviewResult = {
        ...validatedDecision,
        promptVersion: prompt.id,
        artifact
      }

      await this.traceRecorder.record({
        runId: input.context.context.runId,

        step: reviewerStep,

        agent: AgentRole.reviewer,

        workspaceRevision,

        type: TraceEventType.agent_result,

        promptVersion: prompt.id,

        output: {
          recommendation: result.recommendation,

          summary: result.summary,

          findings: result.findings,

          risks: result.risks,

          publicApiChanges: result.publicApiChanges,

          artifact: result.artifact
        }
      })

      logger.info('Review completed', {
        recommendation: result.recommendation,

        findingCount: result.findings.length,

        riskCount: result.risks.length,

        publicApiChangeCount: result.publicApiChanges.length
      })

      return result
    } catch (error) {
      await this.recordFailure(input, promptVersion, error, logger)

      logger.error('Review failed', {
        error
      })

      throw error
    }
  }

  private assertValidInput(input: ReviewInput): void {
    const result = reviewInputSchema.safeParse(input)

    if (!result.success) {
      throw new ReviewerError(
        'Review input failed schema validation: ' +
          z.prettifyError(result.error),
        ReviewerErrorCode.invalid_input,
        {
          cause: result.error
        }
      )
    }
  }

  private async saveArtifact(
    input: ReviewInput,
    promptVersion: PromptVersionIdentifier,
    decision: ReviewDecision
  ) {
    try {
      return await this.artifactStore.save({
        runId: input.context.context.runId,

        promptVersion,

        decision,

        finalDiff: input.finalDiff,

        validationReport: input.validationReport
      })
    } catch (error) {
      throw new ReviewerError(
        'Failed to save review artifact',
        ReviewerErrorCode.artifact_save_failed,
        {
          cause: error
        }
      )
    }
  }

  private recordModelCall(
    input: ReviewInput,
    promptVersion: PromptVersionIdentifier,
    result: ModelResult<ReviewDecision>
  ): Promise<void> {
    return this.traceRecorder.record({
      runId: input.context.context.runId,

      step: reviewerStep,

      agent: AgentRole.reviewer,

      workspaceRevision: input.context.context.workspaceRevision,

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
    input: ReviewInput,
    promptVersion: PromptVersionIdentifier | undefined,
    error: unknown,
    logger: Logger
  ): Promise<void> {
    try {
      await this.traceRecorder.record({
        runId: input.context.context.runId,

        step: reviewerStep,

        agent: AgentRole.reviewer,

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
      logger.warn('Failed to record reviewer failure', {
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
      message: 'Unknown reviewer failure'
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
