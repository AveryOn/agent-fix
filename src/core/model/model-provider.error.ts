export enum ModelProviderErrorCode {
  authentication = 'authentication',
  rate_limit = 'rate_limit',
  timeout = 'timeout',
  invalid_request = 'invalid_request',
  invalid_response = 'invalid_response',
  server = 'server',
  network = 'network',
  unknown = 'unknown'
}

export interface ModelProviderErrorOptions {
  readonly code: ModelProviderErrorCode
  readonly retryable: boolean
  readonly statusCode?: number
  readonly durationMs?: number
  readonly cause?: unknown
}

export class ModelProviderError extends Error {
  readonly code: ModelProviderErrorCode
  readonly retryable: boolean
  readonly statusCode?: number
  readonly durationMs?: number

  constructor(message: string, options: ModelProviderErrorOptions) {
    super(message, {
      cause: options.cause
    })

    this.name = 'ModelProviderError'
    this.code = options.code
    this.retryable = options.retryable

    if (options.statusCode !== undefined) {
      this.statusCode = options.statusCode
    }

    if (options.durationMs !== undefined) {
      this.durationMs = options.durationMs
    }
  }
}
