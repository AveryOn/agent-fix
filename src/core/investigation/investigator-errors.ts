export enum InvestigatorErrorCode {
  invalid_input = 'invalid_input',
  invalid_output = 'invalid_output',
  missing_output = 'missing_output',
  missing_response_id = 'missing_response_id',
  unsupported_tool = 'unsupported_tool',
  invalid_tool_arguments = 'invalid_tool_arguments',
  tool_loop_exhausted = 'tool_loop_exhausted',
  stale_workspace = 'stale_workspace',
  hallucinated_file = 'hallucinated_file',
  hallucinated_symbol = 'hallucinated_symbol',
  invalid_line_range = 'invalid_line_range',
  ungrounded_hypothesis = 'ungrounded_hypothesis'
}

export interface InvestigatorErrorOptions {
  readonly retryable?: boolean
  readonly cause?: unknown
}

export class InvestigatorError extends Error {
  readonly code: InvestigatorErrorCode
  readonly retryable: boolean

  constructor(
    message: string,
    code: InvestigatorErrorCode,
    options: InvestigatorErrorOptions = {}
  ) {
    super(message, {
      cause: options.cause
    })

    this.name = 'InvestigatorError'
    this.code = code
    this.retryable = options.retryable ?? false
  }
}
