import type { ProcessOperationResult } from '~/core/process'

import { describe, expect, it } from 'vitest'
import { ImplementationGate } from '~/application/implementer'
import { ImplementerErrorCode } from '~/core/implementation'
import { ProcessOperation } from '~/core/process'

const marker = 'AGENT_FIX_REPRODUCTION: expected one payment'

describe('ImplementationGate', () => {
  it('accepts a passing reproduction test', () => {
    const gate = new ImplementationGate()

    expect(() =>
      gate.assertReproductionFixed(createCommandResult(), marker)
    ).not.toThrow()
  })

  it('rejects a reproduction test that still fails', () => {
    const gate = new ImplementationGate()

    expect(() =>
      gate.assertReproductionFixed(
        createCommandResult({
          exitCode: 1,
          succeeded: false,
          stderr: marker
        }),
        marker
      )
    ).toThrowError(
      expect.objectContaining({
        code: ImplementerErrorCode.reproduction_test_failed
      })
    )
  })

  it('rejects a timed out test run', () => {
    const gate = new ImplementationGate()

    expect(() =>
      gate.assertReproductionFixed(
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
        code: ImplementerErrorCode.test_execution_failed
      })
    )
  })

  it('rejects successful output containing the failure marker', () => {
    const gate = new ImplementationGate()

    expect(() =>
      gate.assertReproductionFixed(
        createCommandResult({
          stdout: marker
        }),
        marker
      )
    ).toThrowError(
      expect.objectContaining({
        code: ImplementerErrorCode.reproduction_test_failed
      })
    )
  })
})

function createCommandResult(
  overrides: Partial<ProcessOperationResult> = {}
): ProcessOperationResult {
  return {
    executionId: 'execution-002',
    runId: 'run-001',
    workspaceRevision: 'revision-003',

    operation: ProcessOperation.run_tests,

    command: {
      executable: 'npm',
      args: ['run', 'test']
    },

    cwd: '/runs/run-001/workspace',

    startedAt: '2026-08-04T16:00:00.000Z',

    completedAt: '2026-08-04T16:00:01.000Z',

    durationMs: 1000,

    stdout: '1 test passed',
    stderr: '',

    exitCode: 0,
    signal: null,
    timedOut: false,
    succeeded: true,

    artifact: {
      id: 'execution-002',
      type: 'command.result',
      relativePath: 'commands/execution-002.json'
    },

    ...overrides
  }
}
