export interface RetryAttemptContext {
  readonly attempt: number
  readonly maximumAttempts: number
  readonly validationFeedback: readonly string[]
}

export interface RetryExecutionInput<T> {
  readonly operation: (context: RetryAttemptContext) => Promise<T>

  readonly onRetry?: (
    error: unknown,
    context: RetryAttemptContext
  ) => Promise<readonly string[] | void>
}

export interface StepCheckpoint<T = unknown> {
  readonly schemaVersion: 1

  readonly runId: string
  readonly step: string
  readonly executionId: string

  readonly inputHash: string
  readonly outputHash: string

  readonly attempt: number

  readonly workspaceRevision: string | null

  readonly createdAt: string

  readonly output: T
}

export interface SaveStepCheckpointInput<T> {
  readonly runId: string
  readonly step: string
  readonly executionId: string

  readonly inputHash: string
  readonly outputHash: string

  readonly attempt: number

  readonly workspaceRevision: string | null

  readonly output: T
}

export interface StepCheckpointStore {
  load<T>(
    runId: string,
    executionId: string
  ): Promise<StepCheckpoint<T> | null>

  save<T>(input: SaveStepCheckpointInput<T>): Promise<StepCheckpoint<T>>
}

export interface ExecuteStepInput<TInput, TOutput> {
  readonly runId: string
  readonly step: string
  readonly attempt: number

  readonly input: TInput

  readonly workspaceRevision?: string

  readonly preventDuplicateExecution?: boolean

  readonly execute: () => Promise<TOutput>
}

export interface ExecuteStepResult<TOutput> {
  readonly executionId: string

  readonly inputHash: string
  readonly outputHash: string

  readonly resumed: boolean

  readonly output: TOutput
}
