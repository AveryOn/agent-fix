import type {
  EvaluationCase,
  EvaluationCaseResult,
  EvaluationRunResult,
  EvaluationRunnerInput
} from '~/core/evaluation'

import { performance } from 'node:perf_hooks'
import { evaluationRunResultSchema } from '~/core/evaluation'

export class EvaluationRunner {
  async run(input: EvaluationRunnerInput): Promise<EvaluationRunResult> {
    const results: EvaluationCaseResult[] = []

    for (const evaluationCase of input.cases) {
      results.push(await this.executeCase(evaluationCase))
    }

    const passed = results.filter((result) => result.passed).length

    const total = results.length

    return evaluationRunResultSchema.parse({
      schemaVersion: 1,

      suiteId: 'agent-fix-core-evaluation',

      generatedAt: new Date().toISOString(),

      promptVersions: input.promptVersions,

      cases: results,

      summary: {
        total,
        passed,
        failed: total - passed,
        passRate: total === 0 ? 1 : passed / total
      }
    })
  }

  private async executeCase(
    evaluationCase: EvaluationCase
  ): Promise<EvaluationCaseResult> {
    const startedAt = performance.now()

    let actual

    try {
      actual = await evaluationCase.execute()
    } catch (error) {
      actual = {
        classification: 'unexpected_failure' as const,

        attempts: 1,

        errorCode: getErrorCode(error)
      }
    }

    const expected = evaluationCase.definition.expected

    const actualExpectation = {
      classification: actual.classification,

      passed:
        actual.classification === 'accepted' ||
        actual.classification === 'accepted_after_retry',

      attempts: actual.attempts,

      errorCode: actual.errorCode
    }

    return {
      id: evaluationCase.definition.id,

      name: evaluationCase.definition.name,

      passed:
        expected.classification === actualExpectation.classification &&
        expected.passed === actualExpectation.passed &&
        expected.attempts === actualExpectation.attempts &&
        expected.errorCode === actualExpectation.errorCode,

      expected,

      actual: actualExpectation,

      durationMs: Math.max(0, performance.now() - startedAt)
    }
  }
}

function getErrorCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }

  return null
}
