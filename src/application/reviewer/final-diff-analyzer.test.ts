import { describe, expect, it } from 'vitest'
import {
  FinalDiffAnalyzer,
  ReviewDiffSignalKind
} from '~/application/reviewer'
import { DiffLineType } from '~/core/review'

describe('FinalDiffAnalyzer', () => {
  it('parses files, hunks, and line numbers', () => {
    const analyzer = new FinalDiffAnalyzer()

    const analysis = analyzer.analyze(createFinalDiff())

    expect(analysis.files.map((file) => file.path)).toEqual([
      'src/payment-service.ts',
      'tests/payment-webhook.test.ts'
    ])

    expect(analysis.files[0]?.lines).toContainEqual({
      type: DiffLineType.addition,
      lineNumber: 2,
      content: '  if (payments.has(eventId)) {',
      hunkHeader: '@@ -1,3 +1,7 @@'
    })
  })

  it('detects disabled tests and public API candidates', () => {
    const analyzer = new FinalDiffAnalyzer()

    const analysis = analyzer.analyze(createFinalDiff())

    expect(
      analysis.signals.some(
        (signal) =>
          signal.kind === ReviewDiffSignalKind.disabled_test &&
          signal.mandatory
      )
    ).toBe(true)

    expect(
      analysis.signals.some(
        (signal) =>
          signal.kind === ReviewDiffSignalKind.public_api_candidate
      )
    ).toBe(true)
  })

  it('rejects a diff without file headers', () => {
    const analyzer = new FinalDiffAnalyzer()

    expect(() => analyzer.analyze('@@ -1,1 +1,1 @@\n-old\n+new')).toThrow(
      'Final diff does not contain changed files'
    )
  })
})

function createFinalDiff(): string {
  return [
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
}
