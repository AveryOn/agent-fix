export enum ImplementerErrorCode {
  invalid_input = 'invalid_input',
  invalid_output = 'invalid_output',
  missing_output = 'missing_output',
  unexpected_tool_call = 'unexpected_tool_call',
  stale_workspace = 'stale_workspace',
  invalid_patch = 'invalid_patch',
  forbidden_file_change = 'forbidden_file_change',
  reproduction_test_modified = 'reproduction_test_modified',
  patch_application_failed = 'patch_application_failed',
  changed_files_mismatch = 'changed_files_mismatch',
  reproduction_test_failed = 'reproduction_test_failed',
  test_execution_failed = 'test_execution_failed'
}

export interface ImplementerErrorOptions {
  readonly retryable?: boolean
  readonly cause?: unknown
}

export class ImplementerError extends Error {
  readonly code: ImplementerErrorCode
  readonly retryable: boolean

  constructor(
    message: string,
    code: ImplementerErrorCode,
    options: ImplementerErrorOptions = {}
  ) {
    super(message, {
      cause: options.cause
    })

    this.name = 'ImplementerError'
    this.code = code
    this.retryable = options.retryable ?? false
  }
}
