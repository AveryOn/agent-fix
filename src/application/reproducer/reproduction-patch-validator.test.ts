import type { ReproductionPlan } from '~/core/reproduction'

import { describe, expect, it } from 'vitest'
import { ReproductionPatchValidator } from '~/application/reproducer'
import { ReproducerErrorCode } from '~/core/reproduction'

const workspaceRevision = 'revision-001'

const marker = 'AGENT_FIX_REPRODUCTION: expected one payment'

describe('ReproductionPatchValidator', () => {
  it('accepts creation of one new test file', () => {
    const validator = new ReproductionPatchValidator()

    expect(validator.validate(createPlan(), workspaceRevision)).toEqual([
      'tests/payment-duplicate-webhook.test.ts'
    ])
  })

  it('rejects production file changes', () => {
    const validator = new ReproductionPatchValidator()

    expect(() =>
      validator.validate(
        createPlan({
          testFiles: ['src/payment-service.ts'],
          patch: [
            'diff --git a/src/payment-service.ts b/src/payment-service.ts',
            'index 1111111..2222222 100644',
            '--- a/src/payment-service.ts',
            '+++ b/src/payment-service.ts',
            '@@ -1,1 +1,2 @@',
            ' export const value = 1',
            '+export const changed = true'
          ].join('\n')
        }),
        workspaceRevision
      )
    ).toThrowError(
      expect.objectContaining({
        code: ReproducerErrorCode.forbidden_file_change
      })
    )
  })

  it('rejects removal of existing test code', () => {
    const validator = new ReproductionPatchValidator()

    expect(() =>
      validator.validate(
        createPlan({
          patch: [
            'diff --git a/tests/payment-webhook.test.ts b/tests/payment-webhook.test.ts',
            'index 1111111..2222222 100644',
            '--- a/tests/payment-webhook.test.ts',
            '+++ b/tests/payment-webhook.test.ts',
            '@@ -1,2 +1,2 @@',
            '-it("old test", () => {})',
            `+throw new Error('${marker}')`
          ].join('\n')
        }),
        workspaceRevision
      )
    ).toThrowError(
      expect.objectContaining({
        code: ReproducerErrorCode.invalid_patch
      })
    )
  })

  it('rejects a stale patch plan', () => {
    const validator = new ReproductionPatchValidator()

    expect(() =>
      validator.validate(
        createPlan({
          workspaceRevision: 'revision-old'
        }),
        workspaceRevision
      )
    ).toThrowError(
      expect.objectContaining({
        code: ReproducerErrorCode.stale_workspace
      })
    )
  })

  it('requires the expected failure marker in added code', () => {
    const validator = new ReproductionPatchValidator()

    expect(() =>
      validator.validate(
        createPlan({
          patch: [
            'diff --git a/tests/payment-webhook.test.ts b/tests/payment-webhook.test.ts',
            'index 1111111..2222222 100644',
            '--- a/tests/payment-webhook.test.ts',
            '+++ b/tests/payment-webhook.test.ts',
            '@@ -1,1 +1,2 @@',
            ' describe("webhook", () => {})',
            '+throw new Error("different marker")'
          ].join('\n')
        }),
        workspaceRevision
      )
    ).toThrowError(
      expect.objectContaining({
        code: ReproducerErrorCode.invalid_patch
      })
    )
  })

  it('rejects a hunk with incorrect line counts', () => {
    const validator = new ReproductionPatchValidator()

    const plan = createPlan({
      patch: [
        'diff --git a/tests/example.test.ts b/tests/example.test.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/tests/example.test.ts',
        '@@ -0,0 +1,2 @@',
        "+import { expect, it } from 'vitest'",
        '',
        "+it('reproduces the bug', () => {",
        `+  throw new Error('${marker}')`,
        '+})'
      ].join('\n')
    })

    expect(() => validator.validate(plan, workspaceRevision)).toThrowError(
      expect.objectContaining({
        code: ReproducerErrorCode.invalid_patch
      })
    )
  })
  it('rejects a marked assertion of the buggy duplicate count', () => {
    const validator = new ReproductionPatchValidator()

    const plan = createPlan({
      patch: [
        'diff --git a/tests/payment-webhook.test.ts b/tests/payment-webhook.test.ts',
        'index 1111111..2222222 100644',
        '--- a/tests/payment-webhook.test.ts',
        '+++ b/tests/payment-webhook.test.ts',
        '@@ -1,1 +1,5 @@',
        ' describe("webhook", () => {})',
        '+expect(',
        '+  payments.length,',
        `+  '${marker}'`,
        '+).toBe(2)'
      ].join('\n')
    })

    expect(() => validator.validate(plan, workspaceRevision)).toThrowError(
      expect.objectContaining({
        code: ReproducerErrorCode.invalid_patch
      })
    )
  })

  it('rejects beforeEach without a vitest import', () => {
    const validator = new ReproductionPatchValidator()

    const plan = createPlan({
      patch: [
        'diff --git a/tests/payment-webhook.test.ts b/tests/payment-webhook.test.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/tests/payment-webhook.test.ts',
        '@@ -0,0 +1,8 @@',
        "+import { describe, expect, it } from 'vitest'",
        '+',
        "+describe('webhook', () => {",
        '+  beforeEach(() => {})',
        '+',
        '+  expect(',
        `+    payments, '${marker}'`,
        '+  ).toHaveLength(1)',
        '+})'
      ].join('\n')
    })

    expect(() => validator.validate(plan, workspaceRevision)).toThrowError(
      expect.objectContaining({
        code: ReproducerErrorCode.invalid_patch
      })
    )
  })

  it('rejects an unmarked assertion before the marked assertion', () => {
    const validator = new ReproductionPatchValidator()

    const plan = createPlan({
      patch: [
        'diff --git a/tests/payment-webhook.test.ts b/tests/payment-webhook.test.ts',
        'index 1111111..2222222 100644',
        '--- a/tests/payment-webhook.test.ts',
        '+++ b/tests/payment-webhook.test.ts',
        '@@ -1,1 +1,6 @@',
        ' describe("webhook", () => {})',
        '+expect(paymentService.getPayments()).toHaveLength(1)',
        '+expect(',
        '+  paymentService.getPayments(),',
        `+  '${marker}'`,
        '+).toHaveLength(1)'
      ].join('\n')
    })

    expect(() => validator.validate(plan, workspaceRevision)).toThrowError(
      expect.objectContaining({
        code: ReproducerErrorCode.invalid_patch
      })
    )
  })

  it('rejects additive changes to an existing test file', () => {
    const validator = new ReproductionPatchValidator()

    expect(() =>
      validator.validate(
        createPlan({
          testFiles: ['tests/payment-webhook.test.ts'],
          patch: [
            'diff --git a/tests/payment-webhook.test.ts b/tests/payment-webhook.test.ts',
            'index 1111111..2222222 100644',
            '--- a/tests/payment-webhook.test.ts',
            '+++ b/tests/payment-webhook.test.ts',
            '@@ -1,1 +1,5 @@',
            ' describe("webhook", () => {})',
            '+expect(',
            '+  payments,',
            `+  '${marker}'`,
            '+).toHaveLength(1)'
          ].join('\n')
        }),
        workspaceRevision
      )
    ).toThrowError(
      expect.objectContaining({
        code: ReproducerErrorCode.invalid_patch
      })
    )
  })
})

function createPlan(
  overrides: Partial<ReproductionPlan> = {}
): ReproductionPlan {
  return {
    summary: 'Add a regression test for duplicate webhook delivery',

    testFiles: ['tests/payment-duplicate-webhook.test.ts'],

    expectedFailureMarker: marker,

    workspaceRevision,

    patch: [
      'diff --git a/tests/payment-duplicate-webhook.test.ts b/tests/payment-duplicate-webhook.test.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/tests/payment-duplicate-webhook.test.ts',
      '@@ -0,0 +1,12 @@',
      "+import { describe, expect, it } from 'vitest'",
      '+',
      "+describe('duplicate webhook', () => {",
      "+  it('creates one payment for duplicate delivery', () => {",
      "+    const payments = [{ id: 'payment-1' }]",
      '+',
      '+    expect(',
      '+      payments,',
      `+      '${marker}'`,
      '+    ).toHaveLength(1)',
      '+  })',
      '+})'
    ].join('\n'),

    ...overrides
  }
}
