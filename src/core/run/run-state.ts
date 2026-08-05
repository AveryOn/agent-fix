export enum RunStatus {
  created = 'created',
  validating = 'validating',
  ready = 'ready',
  running = 'running',
  awaiting_approval = 'awaiting_approval',
  approved = 'approved',
  rejected = 'rejected',
  completed = 'completed',
  failed = 'failed',
  rolled_back = 'rolled_back',
  preparing_workspace = 'preparing_workspace'
}

export enum RunStepName {
  initialize_run = 'initialize_run',
  validate_target = 'validate_target',
  prepare_workspace = 'prepare_workspace',
  investigator = 'investigator',
  reproducer = 'reproducer',
  implementer = 'implementer',
  mechanical_validation = 'mechanical_validation',
  reviewer = 'reviewer',
  human_approval = 'human_approval',
  finalize = 'finalize',
  rollback = 'rollback',
  cleanup = 'cleanup'
}

export enum RunStepStatus {
  running = 'running',
  succeeded = 'succeeded',
  rejected = 'rejected',
  failed = 'failed'
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
