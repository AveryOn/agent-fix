import type { ProcessOperation } from '~/core/process/process-runner'

export enum ProcessRunnerErrorCode {
  invalid_configuration = 'invalid_configuration',
  invalid_workspace = 'invalid_workspace',
  invalid_run = 'invalid_run',
  spawn_failed = 'spawn_failed'
}

export class ProcessRunnerError extends Error {
  readonly code: ProcessRunnerErrorCode
  readonly operation?: ProcessOperation

  constructor(
    message: string,
    code: ProcessRunnerErrorCode,
    options?: {
      readonly operation?: ProcessOperation
      readonly cause?: unknown
    }
  ) {
    super(message, {
      cause: options?.cause
    })

    this.name = 'ProcessRunnerError'
    this.code = code

    if (options?.operation !== undefined) {
      this.operation = options.operation
    }
  }
}
