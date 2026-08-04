import type { ProcessOperationResult } from '~/core/process'

import { describe, expect, it } from 'vitest'
import { ReproductionGate } from '~/application/reproducer'
import { ProcessOperation } from '~/core/process'
import { ReproducerErrorCode } from '~/core/reproduction'

const marker = 'AGENT_FIX_REPRODUCTION: expected one payment'

describe('ReproductionGate', () => {
  it('accepts the expected pre-fix failure', () => {
    const gate = new ReproductionGate()

    expect(() =>
      gate.assertExpectedFailure(
        createCommandResult({
          exitCode: 1,
          succeeded: false,
          stderr: marker
        }),
        marker
      )
    ).not.toThrow()
  })

  it('rejects a test that already passes', () => {
    const gate = new ReproductionGate()

    expect(() =>
      gate.assertExpectedFailure(
        createCommandResult({
          exitCode: 0,
          succeeded: true
        }),
        marker
      )
    ).toThrowError(
      expect.objectContaining({
        code: ReproducerErrorCode.test_already_passes
      })
    )
  })

  it('rejects an unrelated test failure', () => {
    const gate = new ReproductionGate()

    expect(() =>
      gate.assertExpectedFailure(
        createCommandResult({
          exitCode: 1,
          succeeded: false,
          stderr: 'AssertionError: unrelated test failed'
        }),
        marker
      )
    ).toThrowError(
      expect.objectContaining({
        code: ReproducerErrorCode.unrelated_test_failure
      })
    )
  })

  it('rejects test setup failures', () => {
    const gate = new ReproductionGate()

    expect(() =>
      gate.assertExpectedFailure(
        createCommandResult({
          exitCode: 1,
          succeeded: false,
          stderr: `${marker}\nCannot find module "./fixture"`
        }),
        marker
      )
    ).toThrowError(
      expect.objectContaining({
        code: ReproducerErrorCode.unrelated_test_failure
      })
    )
  })

  it('rejects a timed out test', () => {
    const gate = new ReproductionGate()

    expect(() =>
      gate.assertExpectedFailure(
        createCommandResult({
          exitCode: null,
          succeeded: false,
          timedOut: true,
          signal: 'SIGTERM'
        }),
        marker
      )
    ).toThrowError(
      expect.objectContaining({
        code: ReproducerErrorCode.test_execution_failed
      })
    )
  })
})

function createCommandResult(
  overrides: Partial<ProcessOperationResult> = {}
): ProcessOperationResult {
  return {
    executionId: 'execution-001',
    runId: 'run-001',
    workspaceRevision: 'revision-002',
    operation: ProcessOperation.run_tests,
    command: {
      executable: 'npm',
      args: ['run', 'test']
    },
    cwd: '/runs/run-001/workspace',
    startedAt: '2026-08-04T15:00:00.000Z',
    completedAt: '2026-08-04T15:00:01.000Z',
    durationMs: 1000,
    stdout: '',
    stderr: '',
    exitCode: 1,
    signal: null,
    timedOut: false,
    succeeded: false,
    artifact: {
      id: 'execution-001',
      type: 'command.result',
      relativePath: 'commands/execution-001.json'
    },
    ...overrides
  }
}
