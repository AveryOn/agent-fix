import type { EvaluationRunResult } from '~/core/evaluation'

import { describe, expect, it } from 'vitest'
import { RegressionComparator } from '~/application/evaluation'

describe('RegressionComparator', () => {
  it('accepts matching evaluation results', () => {
    const result = createResult()

    const comparison = new RegressionComparator().compare(result, result)

    expect(comparison.passed).toBe(true)

    expect(comparison.regressions).toEqual([])
  })

  it('detects a changed classification', () => {
    const baseline = createResult()

    const current: EvaluationRunResult = {
      ...baseline,

      cases: baseline.cases.map((evaluationCase) =>
        evaluationCase.id === 'reproduction-test-already-passes'
          ? {
              ...evaluationCase,

              passed: false,

              actual: {
                ...evaluationCase.actual,

                classification: 'accepted',

                passed: true,

                errorCode: null
              }
            }
          : evaluationCase
      )
    }

    const comparison = new RegressionComparator().compare(
      baseline,
      current
    )

    expect(comparison.passed).toBe(false)

    expect(comparison.regressions).toContainEqual(
      expect.objectContaining({
        caseId: 'reproduction-test-already-passes',

        field: 'classification'
      })
    )
  })

  it('detects increased retry attempts', () => {
    const baseline = createResult()

    const current: EvaluationRunResult = {
      ...baseline,

      cases: baseline.cases.map((evaluationCase) =>
        evaluationCase.id === 'retry-then-success'
          ? {
              ...evaluationCase,

              actual: {
                ...evaluationCase.actual,

                attempts: 3
              }
            }
          : evaluationCase
      )
    }

    const comparison = new RegressionComparator().compare(
      baseline,
      current
    )

    expect(comparison.regressions).toContainEqual(
      expect.objectContaining({
        caseId: 'retry-then-success',
        field: 'attempts'
      })
    )
  })
})

function createResult(): EvaluationRunResult {
  return {
    schemaVersion: 1,

    suiteId: 'agent-fix-core-evaluation',

    generatedAt: '2026-08-05T12:00:00.000Z',

    promptVersions: {
      investigator: 'investigator-v1',

      reproducer: 'reproducer-v3',

      implementer: 'implementer-v1',

      reviewer: 'reviewer-v1'
    },

    cases: [
      {
        id: 'reproduction-test-already-passes',

        name: 'Reproduction test already passes',

        passed: true,

        expected: {
          classification: 'pre_fix_test_pass_rejected',

          passed: false,

          attempts: 1,

          errorCode: 'test_already_passes'
        },

        actual: {
          classification: 'pre_fix_test_pass_rejected',

          passed: false,

          attempts: 1,

          errorCode: 'test_already_passes'
        },

        durationMs: 1
      },

      {
        id: 'retry-then-success',

        name: 'Retry then success',

        passed: true,

        expected: {
          classification: 'accepted_after_retry',

          passed: true,

          attempts: 2,

          errorCode: null
        },

        actual: {
          classification: 'accepted_after_retry',

          passed: true,

          attempts: 2,

          errorCode: null
        },

        durationMs: 1
      }
    ],

    summary: {
      total: 2,
      passed: 2,
      failed: 0,
      passRate: 1
    }
  }
}
