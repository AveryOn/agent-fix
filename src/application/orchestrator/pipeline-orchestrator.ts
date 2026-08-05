import type {
  ImplementationRetryRecovery,
  RetryExecutor,
  StepExecutor
} from '~/application/execution'
import type { RunService } from '~/application/run'
import type { AgentContextManager } from '~/core/context'
import type { RetryAttemptContext } from '~/core/execution'
import type {
  ImplementerAgent,
  ImplementationResult
} from '~/core/implementation'
import type {
  InvestigationResult,
  InvestigatorAgent
} from '~/core/investigation'
import type { Logger } from '~/core/logging'
import type {
  FinalRunArtifactStore,
  PipelineRetrySummary,
  PipelineTokenUsage
} from '~/core/orchestrator'
import type {
  ReproducerAgent,
  ReproductionResult
} from '~/core/reproduction'
import type { ReviewerAgent, ReviewResult } from '~/core/review'
import type { HumanApprovalPrompt, RunState } from '~/core/run'
import type { TraceRecorder } from '~/core/trace'
import type {
  ValidationResult,
  ValidationService
} from '~/core/validation'
import type {
  RepositoryToolsFactory,
  WorkspaceManager,
  WorkspaceSnapshot
} from '~/core/workspace'

import { AgentRole, ArtifactType } from '~/core/context'
import { HumanApprovalDecision, RunStatus, RunStepName } from '~/core/run'
import { TraceEventType } from '~/core/trace'

export interface PipelineOrchestratorDependencies {
  readonly runService: RunService
  readonly contextManager: AgentContextManager
  readonly investigatorAgent: InvestigatorAgent
  readonly reproducerAgent: ReproducerAgent
  readonly implementerAgent: ImplementerAgent
  readonly validationService: ValidationService
  readonly reviewerAgent: ReviewerAgent
  readonly workspaceManager: WorkspaceManager
  readonly repositoryToolsFactory: RepositoryToolsFactory
  readonly approvalPrompt: HumanApprovalPrompt
  readonly finalArtifactStore: FinalRunArtifactStore
  readonly retryExecutor: RetryExecutor
  readonly stepExecutor: StepExecutor
  readonly implementationRecovery: ImplementationRetryRecovery
  readonly traceRecorder: TraceRecorder
  readonly logger: Logger
}

export interface PipelineExecutionInput {
  readonly state: RunState
  readonly workspace: WorkspaceSnapshot
}

export interface PipelineExecutionResult {
  readonly state: RunState
  readonly decision: HumanApprovalDecision
}

export class PipelineOrchestrator {
  constructor(
    private readonly dependencies: PipelineOrchestratorDependencies
  ) {}

  async execute(
    input: PipelineExecutionInput
  ): Promise<PipelineExecutionResult> {
    let state = input.state
    let workspace = input.workspace

    const retries = createRetrySummary()

    try {
      const investigationExecution = await this.executeInvestigator(
        state,
        workspace,
        retries
      )

      state = investigationExecution.state

      const investigation = investigationExecution.result

      const reproductionExecution = await this.executeReproducer(
        state,
        workspace,
        investigation,
        retries
      )

      state = reproductionExecution.state
      workspace = reproductionExecution.workspace

      const reproduction = reproductionExecution.result

      const implementationExecution = await this.executeImplementer(
        state,
        workspace,
        investigation,
        reproduction,
        retries
      )

      state = implementationExecution.state
      workspace = implementationExecution.workspace

      const implementation = implementationExecution.result

      const validationExecution = await this.executeValidation(
        state,
        workspace,
        investigation,
        reproduction,
        implementation
      )

      state = validationExecution.state

      const validation = validationExecution.result

      const reviewExecution = await this.executeReviewer(
        state,
        workspace,
        validation,
        retries
      )

      state = reviewExecution.state

      const review = reviewExecution.result

      const tokenUsage = this.getTokenUsage(state.runId)

      this.printPipelineSummary(
        state,
        implementation,
        validation,
        review,
        retries,
        tokenUsage
      )

      state = await this.dependencies.runService.startStep(
        state,
        RunStepName.human_approval,
        RunStatus.awaiting_approval
      )

      const decision =
        await this.dependencies.approvalPrompt.requestApproval({
          runId: state.runId,
          repositoryPath: state.repositoryPath,
          task: state.task,
          finalDiff: validation.finalDiff,
          changedFiles: validation.changedFiles,
          validation: validation.report,
          review,
          retries,
          tokenUsage
        })

      state = await this.dependencies.runService.recordApproval(
        state,
        decision
      )

      state = await this.dependencies.runService.startStep(
        state,
        decision === HumanApprovalDecision.approved
          ? RunStepName.finalize
          : RunStepName.rollback,
        RunStatus.running
      )

      if (decision === HumanApprovalDecision.rejected) {
        workspace =
          await this.dependencies.workspaceManager.rollback(workspace)

        state = await this.dependencies.runService.updateWorkspaceRevision(
          state,
          workspace
        )

        state = await this.dependencies.runService.completeRun(
          state,
          RunStatus.rolled_back,
          'Human rejected final changes; workspace rolled back'
        )

        return {
          state,
          decision
        }
      }

      await this.dependencies.finalArtifactStore.save({
        schemaVersion: 1,
        runId: state.runId,
        task: state.task,
        repositoryPath: state.repositoryPath,
        workspaceRevision: workspace.workspaceRevision,
        finalDiff: validation.finalDiff,
        changedFiles: validation.changedFiles,
        validationPassed: validation.report.passed,
        reviewRecommendation: review.recommendation,
        approvalDecision: decision,
        retries,
        tokenUsage,
        createdAt: new Date().toISOString()
      })

      state = await this.dependencies.runService.completeRun(
        state,
        RunStatus.completed,
        'Final diff approved and saved'
      )

      return {
        state,
        decision
      }
    } catch (error) {
      if (state.currentStep !== null) {
        state = await this.dependencies.runService.failStep(state, error)
      }

      try {
        await this.dependencies.workspaceManager.rollback(workspace)
      } catch (rollbackError) {
        this.dependencies.logger.error('Pipeline rollback failed', {
          runId: state.runId,
          error: rollbackError
        })
      }

      await this.dependencies.traceRecorder.record({
        runId: state.runId,
        step: state.currentStep ?? 'pipeline',
        type: TraceEventType.failure,
        workspaceRevision: workspace.workspaceRevision,
        error: toTraceError(error)
      })

      throw error
    }
  }

  private async executeInvestigator(
    state: RunState,
    workspace: WorkspaceSnapshot,
    retries: MutableRetrySummary
  ): Promise<{
    readonly state: RunState
    readonly result: InvestigationResult
  }> {
    state = await this.dependencies.runService.startStep(
      state,
      RunStepName.investigator,
      RunStatus.running
    )

    const result = await this.dependencies.retryExecutor.execute({
      operation: async (attemptContext) => {
        retries.investigator = attemptContext.attempt - 1

        const context = this.dependencies.contextManager.createSnapshot({
          runId: state.runId,
          agent: AgentRole.investigator,
          task: state.task,
          workspaceRevision: workspace.workspaceRevision,
          artifacts: [
            {
              id: 'repository',
              type: ArtifactType.repository_snapshot,
              workspaceRevision: workspace.workspaceRevision
            }
          ],
          evidence: [],
          constraints: createRetryConstraints(attemptContext)
        })

        const execution = await this.dependencies.stepExecutor.execute({
          runId: state.runId,
          step: RunStepName.investigator,
          attempt: attemptContext.attempt,
          input: {
            context,
            workspaceRevision: workspace.workspaceRevision
          },
          workspaceRevision: workspace.workspaceRevision,
          execute: () =>
            this.dependencies.investigatorAgent.execute({
              context,
              workspace
            })
        })

        return execution.output
      },

      onRetry: (error, attempt) =>
        this.recordRetry(
          state.runId,
          RunStepName.investigator,
          error,
          attempt,
          workspace.workspaceRevision
        )
    })

    state = await this.dependencies.runService.completeStep(
      state,
      RunStepName.investigator,
      RunStatus.ready,
      'Investigation and evidence validation completed'
    )

    return {
      state,
      result
    }
  }

  private async executeReproducer(
    state: RunState,
    initialWorkspace: WorkspaceSnapshot,
    investigation: InvestigationResult,
    retries: MutableRetrySummary
  ): Promise<{
    readonly state: RunState
    readonly workspace: WorkspaceSnapshot
    readonly result: ReproductionResult
  }> {
    state = await this.dependencies.runService.startStep(
      state,
      RunStepName.reproducer,
      RunStatus.running
    )

    let workspace = initialWorkspace

    const result = await this.dependencies.retryExecutor.execute({
      operation: async (attemptContext) => {
        retries.reproducer = attemptContext.attempt - 1

        if (attemptContext.attempt > 1) {
          workspace =
            await this.dependencies.workspaceManager.rollback(workspace)
        }

        const context = this.dependencies.contextManager.createSnapshot({
          runId: state.runId,
          agent: AgentRole.reproducer,
          task: state.task,
          workspaceRevision: workspace.workspaceRevision,
          artifacts: [
            {
              id: 'investigation-result',
              type: ArtifactType.investigation_result,
              workspaceRevision: workspace.workspaceRevision
            },
            {
              id: 'investigation-evidence',
              type: ArtifactType.investigation_evidence,
              workspaceRevision: workspace.workspaceRevision
            }
          ],
          evidence: rebindEvidence(
            investigation.evidence,
            workspace.workspaceRevision
          ),
          constraints: createRetryConstraints(attemptContext),
          investigation
        })

        const execution = await this.dependencies.stepExecutor.execute({
          runId: state.runId,
          step: RunStepName.reproducer,
          attempt: attemptContext.attempt,
          input: {
            context,
            investigation
          },
          workspaceRevision: workspace.workspaceRevision,
          execute: () =>
            this.dependencies.reproducerAgent.execute({
              context,
              investigation: rebindInvestigation(
                investigation,
                workspace.workspaceRevision
              ),
              workspace
            })
        })

        const reproduction = execution.output

        workspace = {
          ...workspace,
          workspaceRevision: reproduction.workspaceRevision
        }

        return reproduction
      },

      onRetry: (error, attempt) =>
        this.recordRetry(
          state.runId,
          RunStepName.reproducer,
          error,
          attempt,
          workspace.workspaceRevision
        )
    })

    state = await this.dependencies.runService.updateWorkspaceRevision(
      state,
      workspace
    )

    state = await this.dependencies.runService.completeStep(
      state,
      RunStepName.reproducer,
      RunStatus.ready,
      'Failing reproduction test confirmed'
    )

    return {
      state,
      workspace,
      result
    }
  }

  private async executeImplementer(
    state: RunState,
    initialWorkspace: WorkspaceSnapshot,
    investigation: InvestigationResult,
    reproduction: ReproductionResult,
    retries: MutableRetrySummary
  ): Promise<{
    readonly state: RunState
    readonly workspace: WorkspaceSnapshot
    readonly result: ImplementationResult
  }> {
    state = await this.dependencies.runService.startStep(
      state,
      RunStepName.implementer,
      RunStatus.running
    )

    let workspace = initialWorkspace

    const result = await this.dependencies.retryExecutor.execute({
      operation: async (attemptContext) => {
        retries.implementer = attemptContext.attempt - 1

        if (attemptContext.attempt > 1) {
          workspace =
            await this.dependencies.implementationRecovery.restoreReproductionWorkspace(
              workspace,
              reproduction
            )
        }

        const evidence = rebindEvidence(
          investigation.evidence,
          workspace.workspaceRevision
        )

        const context = this.dependencies.contextManager.createSnapshot({
          runId: state.runId,
          agent: AgentRole.implementer,
          task: state.task,
          workspaceRevision: workspace.workspaceRevision,
          artifacts: [
            {
              id: 'investigation-evidence',
              type: ArtifactType.investigation_evidence,
              workspaceRevision: workspace.workspaceRevision
            },
            {
              id: 'reproduction-test',
              type: ArtifactType.reproduction_test,
              workspaceRevision: workspace.workspaceRevision
            },
            {
              id: 'allowed-file-scope',
              type: ArtifactType.allowed_file_scope,
              workspaceRevision: workspace.workspaceRevision
            }
          ],
          evidence,
          constraints: createRetryConstraints(attemptContext),
          investigation
        })

        const allowedFiles = investigation.relatedFiles.filter(
          (filePath) => !reproduction.testFiles.includes(filePath)
        )

        if (allowedFiles.length === 0) {
          throw new Error(
            'Investigation did not produce an implementation file scope'
          )
        }

        const execution = await this.dependencies.stepExecutor.execute({
          runId: state.runId,
          step: RunStepName.implementer,
          attempt: attemptContext.attempt,
          input: {
            context,
            evidence,
            reproduction,
            allowedFiles
          },
          workspaceRevision: workspace.workspaceRevision,
          execute: () =>
            this.dependencies.implementerAgent.execute({
              context,
              evidence,
              reproduction: {
                testFiles: reproduction.testFiles,
                expectedFailureMarker: reproduction.expectedFailureMarker,
                workspaceRevision: workspace.workspaceRevision,
                commandResult: {
                  executionId: reproduction.commandResult.executionId,
                  exitCode: reproduction.commandResult.exitCode as number,
                  timedOut: false,
                  succeeded: false,
                  stdout: reproduction.commandResult.stdout,
                  stderr: reproduction.commandResult.stderr
                }
              },
              allowedFileScope: {
                files: allowedFiles,
                workspaceRevision: workspace.workspaceRevision
              },
              workspace
            })
        })

        const implementation = execution.output

        workspace = {
          ...workspace,
          workspaceRevision: implementation.workspaceRevision
        }

        return implementation
      },

      onRetry: (error, attempt) =>
        this.recordRetry(
          state.runId,
          RunStepName.implementer,
          error,
          attempt,
          workspace.workspaceRevision
        )
    })

    state = await this.dependencies.runService.updateWorkspaceRevision(
      state,
      workspace
    )

    state = await this.dependencies.runService.completeStep(
      state,
      RunStepName.implementer,
      RunStatus.ready,
      'Implementation passed the reproduction test'
    )

    return {
      state,
      workspace,
      result
    }
  }

  private async executeValidation(
    state: RunState,
    workspace: WorkspaceSnapshot,
    investigation: InvestigationResult,
    reproduction: ReproductionResult,
    implementation: ImplementationResult
  ): Promise<{
    readonly state: RunState
    readonly result: ValidationResult
  }> {
    state = await this.dependencies.runService.startStep(
      state,
      RunStepName.mechanical_validation,
      RunStatus.validating
    )

    const result = await this.dependencies.validationService.execute({
      runId: state.runId,
      investigation,
      reproduction,
      implementation,
      evidence: investigation.evidence,
      workspace,
      filePolicy: {
        allowedFiles: [
          ...new Set([
            ...reproduction.testFiles,
            ...implementation.changedFiles
          ])
        ],
        forbiddenFiles: ['package-lock.json'],
        forbiddenPrefixes: ['.git', 'node_modules', '.runs']
      }
    })

    state = await this.dependencies.runService.completeStep(
      state,
      RunStepName.mechanical_validation,
      RunStatus.ready,
      result.report.passed
        ? 'Mechanical validation passed'
        : 'Mechanical validation completed with failures'
    )

    return {
      state,
      result
    }
  }

  private async executeReviewer(
    state: RunState,
    workspace: WorkspaceSnapshot,
    validation: ValidationResult,
    retries: MutableRetrySummary
  ): Promise<{
    readonly state: RunState
    readonly result: ReviewResult
  }> {
    state = await this.dependencies.runService.startStep(
      state,
      RunStepName.reviewer,
      RunStatus.running
    )

    const result = await this.dependencies.retryExecutor.execute({
      operation: async (attemptContext) => {
        retries.reviewer = attemptContext.attempt - 1

        const context = this.dependencies.contextManager.createSnapshot({
          runId: state.runId,
          agent: AgentRole.reviewer,
          task: 'Review the final diff using the mechanical validation report.',
          workspaceRevision: workspace.workspaceRevision,
          artifacts: [
            {
              id: 'final-diff',
              type: ArtifactType.final_diff,
              workspaceRevision: workspace.workspaceRevision
            },
            {
              id: 'validation-report',
              type: ArtifactType.validation_report,
              workspaceRevision: workspace.workspaceRevision
            },
            {
              id: 'changed-files',
              type: ArtifactType.changed_files,
              workspaceRevision: workspace.workspaceRevision
            }
          ],
          evidence: [],
          constraints: createRetryConstraints(attemptContext)
        })

        const execution = await this.dependencies.stepExecutor.execute({
          runId: state.runId,
          step: RunStepName.reviewer,
          attempt: attemptContext.attempt,
          input: {
            context,
            finalDiff: validation.finalDiff,
            validationReport: validation.report
          },
          workspaceRevision: workspace.workspaceRevision,
          execute: () =>
            this.dependencies.reviewerAgent.execute({
              context,
              finalDiff: validation.finalDiff,
              changedFiles: validation.changedFiles,
              validationReport: validation.report
            })
        })

        return execution.output
      },

      onRetry: (error, attempt) =>
        this.recordRetry(
          state.runId,
          RunStepName.reviewer,
          error,
          attempt,
          workspace.workspaceRevision
        )
    })

    state = await this.dependencies.runService.completeStep(
      state,
      RunStepName.reviewer,
      RunStatus.ready,
      `Review completed: ${result.recommendation}`
    )

    return {
      state,
      result
    }
  }

  private async recordRetry(
    runId: string,
    step: RunStepName,
    error: unknown,
    attempt: RetryAttemptContext,
    workspaceRevision: string
  ): Promise<readonly string[]> {
    const feedback = createValidationFeedback(error)

    await this.dependencies.traceRecorder.record({
      runId,
      step,
      attempt: attempt.attempt,
      workspaceRevision,
      type: TraceEventType.retry,
      error: toTraceError(error),
      output: {
        nextAttempt: attempt.attempt + 1,
        feedback
      }
    })

    return feedback
  }

  private getTokenUsage(runId: string): PipelineTokenUsage {
    return this.dependencies.traceRecorder.getUsageSummary(runId)
  }

  private printPipelineSummary(
    state: RunState,
    implementation: ImplementationResult,
    validation: ValidationResult,
    review: ReviewResult,
    retries: PipelineRetrySummary,
    usage: PipelineTokenUsage
  ): void {
    const logger = this.dependencies.logger.child({
      runId: state.runId,
      step: 'pipeline-summary'
    })

    logger.info('Pipeline ready for human approval', {
      changedFiles: validation.changedFiles,
      validationPassed: validation.report.passed,
      reviewRecommendation: review.recommendation,
      implementationRisks: implementation.risks,
      reviewRisks: review.risks,
      retries,
      tokenUsage: usage
    })
  }
}

interface MutableRetrySummary {
  investigator: number
  reproducer: number
  implementer: number
  reviewer: number
}

function createRetrySummary(): MutableRetrySummary {
  return {
    investigator: 0,
    reproducer: 0,
    implementer: 0,
    reviewer: 0
  }
}

function createRetryConstraints(
  context: RetryAttemptContext
): readonly string[] {
  const constraints = [
    `Execution attempt ${context.attempt} of ${context.maximumAttempts}.`
  ]

  if (context.validationFeedback.length === 0) {
    return constraints
  }

  return [
    ...constraints,
    'The previous output was rejected mechanically.',
    'Return a corrected complete output.',
    ...context.validationFeedback.map(
      (feedback, index) => `Validation feedback ${index + 1}: ${feedback}`
    )
  ]
}

function createValidationFeedback(error: unknown): readonly string[] {
  if (!(error instanceof Error)) {
    return ['Unknown pipeline failure']
  }

  const feedback = [error.message]

  if ('code' in error && typeof error.code === 'string') {
    feedback.push(`Error code: ${error.code}`)
  }

  return feedback
}

function rebindInvestigation(
  investigation: InvestigationResult,
  workspaceRevision: string
): InvestigationResult {
  return {
    ...investigation,
    workspaceRevision,
    evidence: rebindEvidence(investigation.evidence, workspaceRevision)
  }
}

function rebindEvidence<
  T extends {
    readonly workspaceRevision: string
  }
>(evidence: readonly T[], workspaceRevision: string): T[] {
  return evidence.map((reference) => ({
    ...reference,
    workspaceRevision
  }))
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
      message: 'Unknown pipeline failure'
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
