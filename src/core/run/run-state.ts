export enum RunStatus {
  created = 'created',
  validating = 'validating',
  ready = 'ready',
  awaiting_approval = 'awaiting_approval',
  approved = 'approved',
  rejected = 'rejected',
  running = 'running',
  completed = 'completed',
  failed = 'failed'
}

export enum RunStepName {
  initialize_run = 'initialize_run',
  validate_target = 'validate_target',
  human_approval = 'human_approval',
  prepare_workspace = 'prepare_workspace'
}

export enum RunStepStatus {
  running = 'running',
  succeeded = 'succeeded',
  rejected = 'rejected',
  failed = 'failed',
  preparing_workspace = 'preparing_workspace'
}

export enum HumanApprovalDecision {
  approved = 'approved',
  rejected = 'rejected'
}

export interface RunStepState {
  readonly name: RunStepName
  readonly status: RunStepStatus
  readonly startedAt: string
  readonly completedAt: string | null
  readonly message: string | null
}

export interface RunApproval {
  readonly decision: HumanApprovalDecision
  readonly decidedAt: string
}

export interface RunFailure {
  readonly message: string
  readonly code: string | null
  readonly failedAt: string
}

export interface RunState {
  readonly schemaVersion: 1
  readonly runId: string
  readonly repositoryPath: string
  readonly task: string
  readonly runDirectory: string
  readonly status: RunStatus
  readonly currentStep: RunStepName | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly steps: readonly RunStepState[]
  readonly approval: RunApproval | null
  readonly failure: RunFailure | null

  readonly repositoryRoot: string | null
  readonly repositoryRelativePath: string | null
  readonly workspaceRoot: string | null
  readonly workspacePath: string | null
  readonly baseCommit: string | null
  readonly workspaceRevision: string | null
}
