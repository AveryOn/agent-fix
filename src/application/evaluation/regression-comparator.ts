import type {
  EvaluationComparison,
  EvaluationRegression,
  EvaluationRunResult
} from '~/core/evaluation'

import { evaluationComparisonSchema } from '~/core/evaluation'

const promptNames = [
  'investigator',
  'reproducer',
  'implementer',
  'reviewer'
] as const

export class RegressionComparator {
  compare(
    baseline: EvaluationRunResult,
    current: EvaluationRunResult
  ): EvaluationComparison {
    const regressions: EvaluationRegression[] = []

    for (const baselineCase of baseline.cases) {
      const currentCase = current.cases.find(
        (candidate) => candidate.id === baselineCase.id
      )

      if (currentCase === undefined) {
        regressions.push({
          caseId: baselineCase.id,
          field: 'missing_case',
          baseline: baselineCase,
          current: null
        })

        continue
      }

      if (baselineCase.passed && !currentCase.passed) {
        regressions.push({
          caseId: baselineCase.id,
          field: 'passed',
          baseline: baselineCase.passed,
          current: currentCase.passed
        })
      }

      if (
        baselineCase.actual.classification !==
        currentCase.actual.classification
      ) {
        regressions.push({
          caseId: baselineCase.id,
          field: 'classification',
          baseline: baselineCase.actual.classification,
          current: currentCase.actual.classification
        })
      }

      if (currentCase.actual.attempts > baselineCase.actual.attempts) {
        regressions.push({
          caseId: baselineCase.id,
          field: 'attempts',
          baseline: baselineCase.actual.attempts,
          current: currentCase.actual.attempts
        })
      }

      if (baselineCase.actual.errorCode !== currentCase.actual.errorCode) {
        regressions.push({
          caseId: baselineCase.id,
          field: 'error_code',
          baseline: baselineCase.actual.errorCode,
          current: currentCase.actual.errorCode
        })
      }
    }

    for (const promptName of promptNames) {
      const baselineVersion = baseline.promptVersions[promptName]

      const currentVersion = current.promptVersions[promptName]

      if (
        baselineVersion !== currentVersion &&
        promptName !== 'reproducer'
      ) {
        regressions.push({
          caseId: 'duplicate-payment-fix',
          field: 'prompt_version',
          baseline: {
            prompt: promptName,
            version: baselineVersion
          },
          current: {
            prompt: promptName,
            version: currentVersion
          }
        })
      }
    }

    return evaluationComparisonSchema.parse({
      schemaVersion: 1,

      comparedAt: new Date().toISOString(),

      passed: regressions.length === 0,

      regressions
    })
  }
}
