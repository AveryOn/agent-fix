/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import { RetryExecutor } from '~/application/execution'
import {
  AttemptsExhaustedError,
  ExecutionError,
  ExecutionErrorCode
} from '~/core/execution'

describe('RetryExecutor', () => {
  it('retries retryable failures', async () => {
    const executor = new RetryExecutor(3)

    let attempts = 0

    const result = await executor.execute({
      operation: () => {
        attempts += 1

        if (attempts < 3) {
          throw new ExecutionError(
            'Invalid structured output',
            ExecutionErrorCode.retry_failed,
            {
              retryable: true
            }
          )
        }

        return Promise.resolve('accepted')
      }
    })

    expect(result).toBe('accepted')
    expect(attempts).toBe(3)
  })

  it('does not retry non-retryable failures', async () => {
    const executor = new RetryExecutor(3)

    let attempts = 0

    await expect(
      executor.execute({
        operation: () => {
          attempts += 1

          throw new ExecutionError(
            'Unsafe patch',
            ExecutionErrorCode.retry_failed
          )
        }
      })
    ).rejects.toMatchObject({
      code: ExecutionErrorCode.retry_failed
    })

    expect(attempts).toBe(1)
  })

  it('enforces the maximum attempt limit', async () => {
    const executor = new RetryExecutor(2)

    await expect(
      executor.execute({
        operation: () => {
          throw new ExecutionError(
            'Invalid structured output',
            ExecutionErrorCode.retry_failed,
            {
              retryable: true
            }
          )
        }
      })
    ).rejects.toBeInstanceOf(AttemptsExhaustedError)
  })

  it('passes validation feedback to the next attempt', async () => {
    const executor = new RetryExecutor(2)

    const feedback: readonly string[][] = []

    await executor.execute({
      operation: (context) => {
        const f = feedback as any as string[]
        f.push(context.validationFeedback as any as string)

        if (context.attempt === 1) {
          throw new ExecutionError(
            'Invalid output',
            ExecutionErrorCode.retry_failed,
            {
              retryable: true
            }
          )
        }

        return Promise.resolve('accepted')
      },

      onRetry: () => Promise.resolve(['workspaceRevision is stale'])
    })

    expect(feedback).toEqual([[], ['workspaceRevision is stale']])
  })
})
