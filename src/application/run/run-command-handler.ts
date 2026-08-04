import type { RunService } from '~/application/run/run-service'
import type { CliOutput } from '~/core/cli'
import type { Logger } from '~/core/logging'
import type {
  HumanApprovalPrompt,
  RunState,
  RunValidationReport,
  TargetRepositoryValidator
} from '~/core/run'
import type { TraceRecorder } from '~/core/trace'
import type { WorkspaceManager } from '~/core/workspace'

import { HumanApprovalDecision, RunStatus, RunStepName } from '~/core/run'
import { TraceEventType } from '~/core/trace'

export interface RunCommandInput {
  readonly repositoryPath: string
  readonly task: string
}

export class RunCommandHandler {
  constructor(
    private readonly runService: RunService,
    private readonly repositoryValidator: TargetRepositoryValidator,
    private readonly approvalPrompt: HumanApprovalPrompt,
    private readonly output: CliOutput,
    private readonly logger: Logger,
    private readonly traceRecorder: TraceRecorder,
    private readonly workspaceManager: WorkspaceManager
  ) {}

  async execute(input: RunCommandInput): Promise<number> {
    let state = await this.runService.create(input)

    const logger = this.logger.child({
      runId: state.runId,
      step: 'run-command'
    })

    this.output.writeLine(`Run created: ${state.runId}`)
    this.output.writeLine(`Run directory: ${state.runDirectory}`)

    try {
      state = await this.runService.startStep(
        state,
        RunStepName.validate_target,
        RunStatus.validating
      )

      this.printProgress(state, 'Validating target repository')

      const validation = await this.repositoryValidator.validate(
        state.repositoryPath
      )

      await this.runService.saveValidation(state, validation)

      await this.traceRecorder.record({
        runId: state.runId,
        step: RunStepName.validate_target,
        type: TraceEventType.validation_result,
        output: validation
      })

      this.printValidation(validation)

      if (!validation.passed) {
        const validationError = new Error(
          'Target repository validation failed'
        )

        state = await this.runService.failStep(state, validationError)

        await this.traceRecorder.record({
          runId: state.runId,
          step: RunStepName.validate_target,
          type: TraceEventType.failure,
          error: {
            name: validationError.name,
            message: validationError.message
          }
        })

        logger.warn('Target repository validation failed', {
          repositoryPath: state.repositoryPath
        })

        this.output.writeError('Run stopped: target repository is invalid')

        return 1
      }

      state = await this.runService.completeStep(
        state,
        RunStepName.validate_target,
        RunStatus.ready,
        'Target repository validation passed'
      )

      const workspace = await this.workspaceManager.create({
        runId: state.runId,
        repositoryPath: state.repositoryPath
      })

      state = await this.runService.attachWorkspace(state, workspace)

      await this.traceRecorder.record({
        runId: state.runId,
        step: RunStepName.prepare_workspace,
        workspaceRevision: workspace.workspaceRevision,
        type: TraceEventType.tool_result,
        output: {
          workspacePath: workspace.workspacePath,
          baseCommit: workspace.baseCommit,
          workspaceRevision: workspace.workspaceRevision
        }
      })

      this.output.writeLine(`Workspace: ${workspace.workspacePath}`)

      this.output.writeLine(`Base commit: ${workspace.baseCommit}`)

      this.output.writeLine(
        `Workspace revision: ${workspace.workspaceRevision}`
      )

      state = await this.runService.startStep(
        state,
        RunStepName.human_approval,
        RunStatus.awaiting_approval
      )

      this.printProgress(state, 'Waiting for human approval')

      const decision = await this.approvalPrompt.requestApproval({
        runId: state.runId,
        repositoryPath: state.repositoryPath,
        task: state.task,
        validation
      })

      state = await this.runService.recordApproval(state, decision)

      if (decision === HumanApprovalDecision.approved) {
        logger.info('Run approved by human')
        this.output.writeLine(`Run ${state.runId} approved`)
      } else {
        logger.info('Run rejected by human')
        this.output.writeLine(`Run ${state.runId} rejected`)
      }

      return 0
    } catch (error) {
      if (state.currentStep !== null) {
        state = await this.runService.failStep(state, error)
      }

      await this.traceRecorder.record({
        runId: state.runId,
        step: state.currentStep ?? 'run-command',
        type: TraceEventType.failure,
        error: toTraceError(error)
      })

      logger.error('Run command failed', {
        error
      })

      throw error
    }
  }

  private printProgress(state: RunState, message: string): void {
    this.output.writeLine(
      `[${state.runId}] ${state.currentStep ?? 'unknown'}: ${message}`
    )
  }

  private printValidation(report: RunValidationReport): void {
    this.output.writeLine('')
    this.output.writeLine('Validation results:')

    for (const check of report.checks) {
      const marker = check.passed ? 'PASS' : 'FAIL'

      this.output.writeLine(`  [${marker}] ${check.message}`)
    }

    this.output.writeLine(
      `Validation: ${report.passed ? 'PASSED' : 'FAILED'}`
    )
    this.output.writeLine('')
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
      message: 'Unknown run command failure'
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
