import type {
  RetryAttemptContext,
  RetryExecutionInput
} from '~/core/execution'

import {
  AttemptsExhaustedError,
  ExecutionError,
  ExecutionErrorCode,
  ExecutionFailureKind,
  isRetryableError
} from '~/core/execution'

export class RetryExecutor {
  constructor(private readonly maximumAttempts: number) {
    if (!Number.isInteger(maximumAttempts) || maximumAttempts <= 0) {
      throw new ExecutionError(
        'Maximum attempt limit must be a positive integer',
        ExecutionErrorCode.invalid_attempt_limit,
        {
          kind: ExecutionFailureKind.fatal
        }
      )
    }
  }

  async execute<T>(input: RetryExecutionInput<T>): Promise<T> {
    let validationFeedback: readonly string[] = []

    let lastError: unknown

    for (let attempt = 1; attempt <= this.maximumAttempts; attempt += 1) {
      const context: RetryAttemptContext = {
        attempt,
        maximumAttempts: this.maximumAttempts,
        validationFeedback
      }

      try {
        return await input.operation(context)
      } catch (error) {
        lastError = error

        if (!isRetryableError(error)) {
          throw error
        }

        if (attempt >= this.maximumAttempts) {
          break
        }

        const feedback = await input.onRetry?.(error, context)

        if (feedback !== undefined) {
          validationFeedback = [...validationFeedback, ...feedback]
        }
      }
    }

    throw new AttemptsExhaustedError(this.maximumAttempts, lastError)
  }
}
