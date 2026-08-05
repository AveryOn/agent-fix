export enum ExecutionFailureKind {
  retryable = 'retryable',
  non_retryable = 'non_retryable',
  fatal = 'fatal'
}

export enum ExecutionErrorCode {
  attempts_exhausted = 'attempts_exhausted',
  checkpoint_corrupted = 'checkpoint_corrupted',
  checkpoint_input_mismatch = 'checkpoint_input_mismatch',
  duplicate_patch_application = 'duplicate_patch_application',
  invalid_attempt_limit = 'invalid_attempt_limit',
  retry_failed = 'retry_failed',
  rollback_failed = 'rollback_failed',
  stale_checkpoint = 'stale_checkpoint'
}

export interface ExecutionErrorOptions {
  readonly kind?: ExecutionFailureKind
  readonly retryable?: boolean
  readonly cause?: unknown
}

export class ExecutionError extends Error {
  readonly code: ExecutionErrorCode
  readonly kind: ExecutionFailureKind
  readonly retryable: boolean
  readonly fatal: boolean

  constructor(
    message: string,
    code: ExecutionErrorCode,
    options: ExecutionErrorOptions = {}
  ) {
    super(message, {
      cause: options.cause
    })

    const kind =
      options.kind ??
      (options.retryable === true
        ? ExecutionFailureKind.retryable
        : ExecutionFailureKind.non_retryable)

    this.name = 'ExecutionError'
    this.code = code
    this.kind = kind
    this.retryable = kind === ExecutionFailureKind.retryable
    this.fatal = kind === ExecutionFailureKind.fatal
  }
}

export class AttemptsExhaustedError extends ExecutionError {
  readonly attempts: number
  readonly lastError: unknown

  constructor(attempts: number, lastError: unknown) {
    super(
      `Maximum attempt limit reached after ${attempts} attempts`,
      ExecutionErrorCode.attempts_exhausted,
      {
        kind: ExecutionFailureKind.non_retryable,
        cause: lastError
      }
    )

    this.name = 'AttemptsExhaustedError'
    this.attempts = attempts
    this.lastError = lastError
  }
}

export function getExecutionFailureKind(
  error: unknown
): ExecutionFailureKind {
  if (isBooleanProperty(error, 'fatal', true)) {
    return ExecutionFailureKind.fatal
  }

  if (isBooleanProperty(error, 'retryable', true)) {
    return ExecutionFailureKind.retryable
  }

  return ExecutionFailureKind.non_retryable
}

export function isRetryableError(error: unknown): boolean {
  return getExecutionFailureKind(error) === ExecutionFailureKind.retryable
}

function isBooleanProperty(
  value: unknown,
  property: string,
  expected: boolean
): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    property in value &&
    value[property as keyof typeof value] === expected
  )
}
