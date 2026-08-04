import type { ProcessOperationResult } from '~/core/process'

import { ProcessOperation } from '~/core/process'
import { ReproducerError, ReproducerErrorCode } from '~/core/reproduction'

const unrelatedFailurePatterns: readonly RegExp[] = [
  /\bno test files found\b/i,
  /\bno tests found\b/i,
  /\bcannot find module\b/i,
  /\berr_module_not_found\b/i,
  /\bfailed to resolve import\b/i,
  /\btest suite failed to run\b/i,
  /\bsyntaxerror\b/i,
  /\bts\d{4}:/i,
  /\bmissing script:\s*["']?test/i,
  /\bcommand not found\b/i
]

export class ReproductionGate {
  assertExpectedFailure(
    commandResult: ProcessOperationResult,
    expectedFailureMarker: string
  ): void {
    if (commandResult.operation !== ProcessOperation.run_tests) {
      throw new ReproducerError(
        'Reproduction gate received a non-test command result',
        ReproducerErrorCode.test_execution_failed
      )
    }

    if (commandResult.timedOut) {
      throw new ReproducerError(
        'Reproduction test timed out',
        ReproducerErrorCode.test_execution_failed,
        {
          retryable: true
        }
      )
    }

    if (commandResult.succeeded || commandResult.exitCode === 0) {
      throw new ReproducerError(
        'Reproduction test passed before implementation',
        ReproducerErrorCode.test_already_passes,
        {
          retryable: true
        }
      )
    }

    if (commandResult.exitCode === null) {
      throw new ReproducerError(
        'Reproduction test did not produce an exit code',
        ReproducerErrorCode.test_execution_failed,
        {
          retryable: true
        }
      )
    }

    const output = normalizeOutput(
      `${commandResult.stdout}\n${commandResult.stderr}`
    )

    if (!output.includes(expectedFailureMarker)) {
      throw new ReproducerError(
        'Reproduction test failed for an unrelated reason',
        ReproducerErrorCode.unrelated_test_failure,
        {
          retryable: true
        }
      )
    }

    const unrelatedFailure = unrelatedFailurePatterns.find((pattern) =>
      pattern.test(output)
    )

    if (unrelatedFailure !== undefined) {
      throw new ReproducerError(
        'Reproduction output contains an infrastructure ' +
          'or test setup failure',
        ReproducerErrorCode.unrelated_test_failure,
        {
          retryable: true
        }
      )
    }
  }
}

function normalizeOutput(output: string): string {
  return (
    output
      // eslint-disable-next-line no-control-regex
      .replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
      .replaceAll('\r\n', '\n')
  )
}
