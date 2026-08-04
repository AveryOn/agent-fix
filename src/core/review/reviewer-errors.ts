export enum ReviewerErrorCode {
  invalid_input = 'invalid_input',
  invalid_output = 'invalid_output',
  missing_output = 'missing_output',
  unexpected_tool_call = 'unexpected_tool_call',
  invalid_diff = 'invalid_diff',
  changed_files_mismatch = 'changed_files_mismatch',
  stale_workspace = 'stale_workspace',
  ungrounded_finding = 'ungrounded_finding',
  missed_suspicious_change = 'missed_suspicious_change',
  missed_excessive_change = 'missed_excessive_change',
  invalid_recommendation = 'invalid_recommendation',
  artifact_save_failed = 'artifact_save_failed'
}

export interface ReviewerErrorOptions {
  readonly retryable?: boolean
  readonly cause?: unknown
}

export class ReviewerError extends Error {
  readonly code: ReviewerErrorCode
  readonly retryable: boolean

  constructor(
    message: string,
    code: ReviewerErrorCode,
    options: ReviewerErrorOptions = {}
  ) {
    super(message, {
      cause: options.cause
    })

    this.name = 'ReviewerError'
    this.code = code
    this.retryable = options.retryable ?? false
  }
}
