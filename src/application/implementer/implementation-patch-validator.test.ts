import type {
  AllowedFileScope,
  ImplementationPlan,
  ReproductionFailureSnapshot
} from '~/core/implementation'

import { describe, expect, it } from 'vitest'
import { ImplementationPatchValidator } from '~/application/implementer'
import { ImplementerErrorCode } from '~/core/implementation'

const workspaceRevision = 'revision-002'

describe('ImplementationPatchValidator', () => {
  it('accepts changes inside the allowed scope', () => {
    const validator = new ImplementationPatchValidator()

    expect(
      validator.validate(
        createPlan(),
        createAllowedScope(),
        createReproduction(),
        workspaceRevision
      )
    ).toEqual(['src/payment-service.ts'])
  })

  it('rejects changes outside the allowed scope', () => {
    const validator = new ImplementationPatchValidator()

    expect(() =>
      validator.validate(
        createPlan({
          changedFiles: ['src/unrelated.ts'],

          patch: createPatch('src/unrelated.ts')
        }),
        createAllowedScope(),
        createReproduction(),
        workspaceRevision
      )
    ).toThrowError(
      expect.objectContaining({
        code: ImplementerErrorCode.forbidden_file_change
      })
    )
  })

  it('rejects reproduction test changes', () => {
    const validator = new ImplementationPatchValidator()

    expect(() =>
      validator.validate(
        createPlan({
          changedFiles: ['tests/payment-webhook.test.ts'],

          patch: createPatch('tests/payment-webhook.test.ts')
        }),

        {
          files: [
            'src/payment-service.ts',
            'tests/payment-webhook.test.ts'
          ],
          workspaceRevision
        },

        createReproduction(),
        workspaceRevision
      )
    ).toThrowError(
      expect.objectContaining({
        code: ImplementerErrorCode.reproduction_test_modified
      })
    )
  })

  it('rejects a stale implementation plan', () => {
    const validator = new ImplementationPatchValidator()

    expect(() =>
      validator.validate(
        createPlan({
          workspaceRevision: 'revision-old'
        }),
        createAllowedScope(),
        createReproduction(),
        workspaceRevision
      )
    ).toThrowError(
      expect.objectContaining({
        code: ImplementerErrorCode.stale_workspace
      })
    )
  })

  it('rejects mismatched declared files', () => {
    const validator = new ImplementationPatchValidator()

    expect(() =>
      validator.validate(
        createPlan({
          changedFiles: ['src/webhook-handler.ts']
        }),
        createAllowedScope(),
        createReproduction(),
        workspaceRevision
      )
    ).toThrowError(
      expect.objectContaining({
        code: ImplementerErrorCode.changed_files_mismatch
      })
    )
  })
})

function createAllowedScope(): AllowedFileScope {
  return {
    files: ['src/payment-service.ts', 'src/webhook-handler.ts'],
    workspaceRevision
  }
}

function createReproduction(): ReproductionFailureSnapshot {
  const marker = 'AGENT_FIX_REPRODUCTION: expected one payment'

  return {
    testFiles: ['tests/payment-webhook.test.ts'],

    expectedFailureMarker: marker,

    workspaceRevision,

    commandResult: {
      executionId: 'execution-001',
      exitCode: 1,
      timedOut: false,
      succeeded: false,
      stdout: '',
      stderr: marker
    }
  }
}

function createPlan(
  overrides: Partial<ImplementationPlan> = {}
): ImplementationPlan {
  return {
    summary: 'Add an idempotency check before inserting a payment',

    patch: createPatch('src/payment-service.ts'),

    changedFiles: ['src/payment-service.ts'],

    risks: [
      'Concurrent webhook deliveries require atomic storage semantics'
    ],

    workspaceRevision,

    ...overrides
  }
}

function createPatch(filePath: string): string {
  return [
    `diff --git a/${filePath} b/${filePath}`,
    'index 1111111..2222222 100644',
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    '@@ -1,3 +1,7 @@',
    ' export function createPayment(eventId: string) {',
    '+  if (payments.some((payment) => payment.eventId === eventId)) {',
    '+    return',
    '+  }',
    '+',
    '   return payments.push({ eventId })',
    ' }'
  ].join('\n')
}
