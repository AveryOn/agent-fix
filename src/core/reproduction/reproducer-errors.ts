export enum ReproducerErrorCode {
  invalid_input = 'invalid_input',
  invalid_output = 'invalid_output',
  missing_output = 'missing_output',
  unexpected_tool_call = 'unexpected_tool_call',
  stale_workspace = 'stale_workspace',
  invalid_patch = 'invalid_patch',
  forbidden_file_change = 'forbidden_file_change',
  patch_application_failed = 'patch_application_failed',
  changed_files_mismatch = 'changed_files_mismatch',
  test_already_passes = 'test_already_passes',
  unrelated_test_failure = 'unrelated_test_failure',
  test_execution_failed = 'test_execution_failed'
}

export interface ReproducerErrorOptions {
  readonly retryable?: boolean
  readonly cause?: unknown
}

export class ReproducerError extends Error {
  readonly code: ReproducerErrorCode
  readonly retryable: boolean

  constructor(
    message: string,
    code: ReproducerErrorCode,
    options: ReproducerErrorOptions = {}
  ) {
    super(message, {
      cause: options.cause
    })

    this.name = 'ReproducerError'
    this.code = code
    this.retryable = options.retryable ?? false
  }
}
