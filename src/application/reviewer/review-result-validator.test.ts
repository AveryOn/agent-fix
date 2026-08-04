import type { ReviewDecision, ReviewInput } from '~/core/review'

import { describe, expect, it } from 'vitest'
import {
  FinalDiffAnalyzer,
  ReviewResultValidator
} from '~/application/reviewer'
import { AgentRole } from '~/core/context'
import {
  DiffLineType,
  ReviewFindingCategory,
  ReviewRecommendation,
  ReviewerErrorCode,
  ReviewSeverity
} from '~/core/review'
import {
  MechanicalValidationCheckStatus,
  ValidationCheckId
} from '~/core/validation'

const workspaceRevision = 'revision-004'

describe('ReviewResultValidator', () => {
  it('accepts grounded review evidence', () => {
    const input = createInput()
    const analysis = new FinalDiffAnalyzer().analyze(input.finalDiff)

    const validator = new ReviewResultValidator()

    expect(validator.validate(createDecision(), input, analysis)).toEqual(
      createDecision()
    )
  })

  it('rejects hallucinated diff evidence', () => {
    const input = createInput()
    const analysis = new FinalDiffAnalyzer().analyze(input.finalDiff)

    const decision = createDecision({
      findings: [
        {
          ...createDecision().findings[0]!,
          evidence: [
            {
              ...createDecision().findings[0]!.evidence[0]!,
              lineContent: 'missing diff content'
            }
          ]
        }
      ]
    })

    const validator = new ReviewResultValidator()

    expect(() =>
      validator.validate(decision, input, analysis)
    ).toThrowError(
      expect.objectContaining({
        code: ReviewerErrorCode.ungrounded_finding
      })
    )
  })

  it('rejects approval after failed validation', () => {
    const input: ReviewInput = {
      ...createInput(),

      validationReport: {
        ...createInput().validationReport,

        passed: false,

        checks: [
          {
            id: ValidationCheckId.full_test_suite,
            status: MechanicalValidationCheckStatus.failed,
            required: true,
            message: 'Tests failed'
          }
        ]
      }
    }

    const analysis = new FinalDiffAnalyzer().analyze(input.finalDiff)

    const validator = new ReviewResultValidator()

    expect(() =>
      validator.validate(
        createDecision({
          recommendation: ReviewRecommendation.approve,

          findings: []
        }),
        input,
        analysis
      )
    ).toThrowError(
      expect.objectContaining({
        code: ReviewerErrorCode.invalid_recommendation
      })
    )
  })

  it('requires mandatory suspicious signals to be reviewed', () => {
    const input = createInput()
    const analysis = new FinalDiffAnalyzer().analyze(input.finalDiff)

    const validator = new ReviewResultValidator()

    expect(() =>
      validator.validate(
        createDecision({
          findings: []
        }),
        input,
        analysis
      )
    ).toThrowError(
      expect.objectContaining({
        code: ReviewerErrorCode.missed_suspicious_change
      })
    )
  })
})

function createDecision(
  overrides: Partial<ReviewDecision> = {}
): ReviewDecision {
  return {
    recommendation: ReviewRecommendation.request_changes,

    summary: 'The implementation disables the reproduction test.',

    findings: [
      {
        id: 'disabled-reproduction-test',

        category: ReviewFindingCategory.test_quality,

        severity: ReviewSeverity.high,

        blocking: true,

        title: 'Reproduction test was disabled',

        description: 'The final diff changes the test to it.skip.',

        evidence: [
          {
            filePath: 'tests/payment-webhook.test.ts',

            hunkHeader: '@@ -1,3 +1,3 @@',

            lineType: DiffLineType.addition,

            lineNumber: 1,

            lineContent: 'it.skip("creates one payment", () => {'
          }
        ]
      }
    ],

    risks: [],

    publicApiChanges: [
      {
        kind: 'modified',

        filePath: 'src/payment-service.ts',

        symbol: 'createPayment',

        description: 'The exported createPayment behavior changes.',

        evidence: [
          {
            filePath: 'src/payment-service.ts',

            hunkHeader: '@@ -1,3 +1,7 @@',

            lineType: DiffLineType.context,

            lineNumber: 1,

            lineContent: 'export function createPayment(eventId: string) {'
          }
        ]
      }
    ],

    workspaceRevision,

    ...overrides
  }
}

function createInput(): ReviewInput {
  const finalDiff = [
    'diff --git a/src/payment-service.ts b/src/payment-service.ts',
    'index 1111111..2222222 100644',
    '--- a/src/payment-service.ts',
    '+++ b/src/payment-service.ts',
    '@@ -1,3 +1,7 @@',
    ' export function createPayment(eventId: string) {',
    '+  if (payments.has(eventId)) {',
    '+    return',
    '+  }',
    '+',
    '   return payments.push({ eventId })',
    ' }',
    'diff --git a/tests/payment-webhook.test.ts b/tests/payment-webhook.test.ts',
    'index 3333333..4444444 100644',
    '--- a/tests/payment-webhook.test.ts',
    '+++ b/tests/payment-webhook.test.ts',
    '@@ -1,3 +1,3 @@',
    '-it("creates one payment", () => {',
    '+it.skip("creates one payment", () => {',
    '   expect(payments).toHaveLength(1)',
    ' })'
  ].join('\n')

  return {
    context: {
      agent: AgentRole.reviewer,

      createdAt: '2026-08-04T16:00:00.000Z',

      estimatedTokens: 500,

      context: {
        runId: 'run-001',

        task: 'Review the final diff using the validation report and changed file list.',

        workspaceRevision,

        artifactIds: ['final-diff', 'validation-report', 'changed-files'],

        evidence: [],

        constraints: []
      }
    },

    finalDiff,

    changedFiles: [
      'src/payment-service.ts',
      'tests/payment-webhook.test.ts'
    ],

    validationReport: {
      schemaVersion: 1,

      runId: 'run-001',

      workspaceRevision,

      generatedAt: '2026-08-04T16:00:00.000Z',

      passed: true,

      changedFiles: [
        'src/payment-service.ts',
        'tests/payment-webhook.test.ts'
      ],

      forbiddenFiles: [],

      checks: [
        {
          id: ValidationCheckId.full_test_suite,

          status: MechanicalValidationCheckStatus.passed,

          required: true,

          message: 'Tests passed'
        }
      ]
    }
  }
}
