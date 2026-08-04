import type { RunState, RunStore, RunValidationReport } from '~/core/run'
import type { WorkspaceSnapshot } from '~/core/workspace'

import { randomUUID } from 'node:crypto'
import {
  HumanApprovalDecision,
  RunStatus,
  RunStepName,
  RunStepStatus
} from '~/core/run'

export interface CreateRunInput {
  readonly repositoryPath: string
  readonly task: string
}

export type RunIdFactory = (now: Date) => string

export class RunService {
  constructor(
    private readonly store: RunStore,
    private readonly now: () => Date = () => new Date(),
    private readonly runIdFactory: RunIdFactory = createRunId
  ) {}

  async create(input: CreateRunInput): Promise<RunState> {
    const now = this.now()
    const timestamp = now.toISOString()
    const runId = this.runIdFactory(now)

    const state: RunState = {
      schemaVersion: 1,
      runId,
      repositoryPath: input.repositoryPath,
      task: input.task,
      runDirectory: this.store.getRunDirectory(runId),
      status: RunStatus.created,
      currentStep: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      approval: null,
      failure: null,
      repositoryRoot: null,
      repositoryRelativePath: null,
      workspaceRoot: null,
      workspacePath: null,
      baseCommit: null,
      workspaceRevision: null,
      steps: [
        {
          name: RunStepName.initialize_run,
          status: RunStepStatus.succeeded,
          startedAt: timestamp,
          completedAt: timestamp,
          message: 'Run directory initialized'
        }
      ]
    }

    await this.store.create({
      state
    })

    return state
  }

  async startStep(
    state: RunState,
    stepName: RunStepName,
    status: RunStatus
  ): Promise<RunState> {
    if (state.currentStep !== null) {
      throw new Error(
        `Run ${state.runId} already has active step ${state.currentStep}`
      )
    }

    const timestamp = this.now().toISOString()

    const nextState: RunState = {
      ...state,
      status,
      currentStep: stepName,
      updatedAt: timestamp,
      steps: [
        ...state.steps,
        {
          name: stepName,
          status: RunStepStatus.running,
          startedAt: timestamp,
          completedAt: null,
          message: null
        }
      ]
    }

    await this.store.saveState(nextState)

    return nextState
  }

  async completeStep(
    state: RunState,
    stepName: RunStepName,
    status: RunStatus,
    message: string
  ): Promise<RunState> {
    this.assertCurrentStep(state, stepName)

    const timestamp = this.now().toISOString()
    const stepIndex = this.findCurrentStepIndex(state, stepName)

    const steps = state.steps.map((step, index) =>
      index === stepIndex
        ? {
            ...step,
            status: RunStepStatus.succeeded,
            completedAt: timestamp,
            message
          }
        : step
    )

    const nextState: RunState = {
      ...state,
      status,
      currentStep: null,
      updatedAt: timestamp,
      steps
    }

    await this.store.saveState(nextState)

    return nextState
  }

  async failStep(state: RunState, error: unknown): Promise<RunState> {
    if (state.currentStep === null) {
      throw new Error(`Run ${state.runId} does not have an active step`)
    }

    const timestamp = this.now().toISOString()
    const message = getErrorMessage(error)
    const code = getErrorCode(error)

    const stepIndex = this.findCurrentStepIndex(state, state.currentStep)

    const steps = state.steps.map((step, index) =>
      index === stepIndex
        ? {
            ...step,
            status: RunStepStatus.failed,
            completedAt: timestamp,
            message
          }
        : step
    )

    const nextState: RunState = {
      ...state,
      status: RunStatus.failed,
      currentStep: null,
      updatedAt: timestamp,
      steps,
      failure: {
        message,
        code,
        failedAt: timestamp
      }
    }

    await this.store.saveState(nextState)

    return nextState
  }

  async recordApproval(
    state: RunState,
    decision: HumanApprovalDecision
  ): Promise<RunState> {
    this.assertCurrentStep(state, RunStepName.human_approval)

    const timestamp = this.now().toISOString()
    const stepIndex = this.findCurrentStepIndex(
      state,
      RunStepName.human_approval
    )

    const approved = decision === HumanApprovalDecision.approved

    const steps = state.steps.map((step, index) =>
      index === stepIndex
        ? {
            ...step,
            status: approved
              ? RunStepStatus.succeeded
              : RunStepStatus.rejected,
            completedAt: timestamp,
            message: approved
              ? 'Run approved by human'
              : 'Run rejected by human'
          }
        : step
    )

    const nextState: RunState = {
      ...state,
      status: approved ? RunStatus.approved : RunStatus.rejected,
      currentStep: null,
      updatedAt: timestamp,
      steps,
      approval: {
        decision,
        decidedAt: timestamp
      }
    }

    await this.store.saveState(nextState)

    return nextState
  }

  saveValidation(
    state: RunState,
    report: RunValidationReport
  ): Promise<void> {
    return this.store.saveValidation(state.runId, report)
  }

  async attachWorkspace(
    state: RunState,
    workspace: WorkspaceSnapshot
  ): Promise<RunState> {
    this.assertCurrentStep(state, RunStepName.prepare_workspace)

    const timestamp = this.now().toISOString()

    const stepIndex = this.findCurrentStepIndex(
      state,
      RunStepName.prepare_workspace
    )

    const steps = state.steps.map((step, index) =>
      index === stepIndex
        ? {
            ...step,
            status: RunStepStatus.succeeded,
            completedAt: timestamp,
            message: 'Isolated Git workspace created'
          }
        : step
    )

    const nextState: RunState = {
      ...state,
      repositoryPath: workspace.repositoryPath,
      repositoryRoot: workspace.repositoryRoot,
      repositoryRelativePath: workspace.repositoryRelativePath,
      workspaceRoot: workspace.workspaceRoot,
      workspacePath: workspace.workspacePath,
      baseCommit: workspace.baseCommit,
      workspaceRevision: workspace.workspaceRevision,
      status: RunStatus.ready,
      currentStep: null,
      updatedAt: timestamp,
      steps
    }

    await this.store.saveState(nextState)

    return nextState
  }

  private assertCurrentStep(state: RunState, stepName: RunStepName): void {
    if (state.currentStep !== stepName) {
      throw new Error(
        `Expected current step ${stepName}, received ${state.currentStep ?? 'none'}`
      )
    }
  }

  private findCurrentStepIndex(
    state: RunState,
    stepName: RunStepName
  ): number {
    const stepIndex = state.steps.findLastIndex(
      (step) =>
        step.name === stepName && step.status === RunStepStatus.running
    )

    if (stepIndex === -1) {
      throw new Error(`Active step ${stepName} was not found in run state`)
    }

    return stepIndex
  }
}

export function createRunId(now: Date): string {
  const timestamp = now
    .toISOString()
    .replaceAll(/[^0-9]/g, '')
    .slice(0, 14)

  const suffix = randomUUID().slice(0, 8)

  return `run-${timestamp}-${suffix}`
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown run failure'
}

function getErrorCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }

  return null
}
