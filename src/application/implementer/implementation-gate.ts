import type { ProcessOperationResult } from '~/core/process'

import {
  ImplementerError,
  ImplementerErrorCode
} from '~/core/implementation'
import { ProcessOperation } from '~/core/process'

export class ImplementationGate {
  assertReproductionFixed(
    commandResult: ProcessOperationResult,
    expectedFailureMarker: string
  ): void {
    if (commandResult.operation !== ProcessOperation.run_tests) {
      throw new ImplementerError(
        'Implementation gate received a non-test command result',
        ImplementerErrorCode.test_execution_failed
      )
    }

    if (commandResult.timedOut) {
      throw new ImplementerError(
        'Post-implementation test run timed out',
        ImplementerErrorCode.test_execution_failed,
        {
          retryable: true
        }
      )
    }

    if (!commandResult.succeeded || commandResult.exitCode !== 0) {
      throw new ImplementerError(
        'Reproduction test still fails after implementation',
        ImplementerErrorCode.reproduction_test_failed,
        {
          retryable: true
        }
      )
    }

    const output = normalizeOutput(
      `${commandResult.stdout}\n${commandResult.stderr}`
    )

    if (output.includes(expectedFailureMarker)) {
      throw new ImplementerError(
        'Successful test output still contains the reproduction marker',
        ImplementerErrorCode.reproduction_test_failed,
        {
          retryable: true
        }
      )
    }
  }
}

function normalizeOutput(output: string): string {
  return output
    .replaceAll(
      // eslint-disable-next-line no-control-regex
      /\u001B\[[0-?]*[ -/]*[@-~]/g,
      ''
    )
    .replaceAll('\r\n', '\n')
}
