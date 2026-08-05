import path from 'node:path'
import { createEvaluationCases } from '../src/application/evaluation/evaluation-cases.js'
import { EvaluationRunner } from '../src/application/evaluation/evaluation-runner.js'
import { RegressionComparator } from '../src/application/evaluation/regression-comparator.js'
import { FileEvaluationStore } from '../src/infra/evaluation/file-evaluation-store.js'

const promptVersions = {
  investigator: 'investigator-v1',

  reproducer: 'reproducer-v4',

  implementer: 'implementer-v1',

  reviewer: 'reviewer-v1'
} as const

async function main(): Promise<void> {
  const store = new FileEvaluationStore({
    rootDirectory: path.resolve('evaluations')
  })

  const runner = new EvaluationRunner()

  const current = await runner.run({
    promptVersions,
    cases: createEvaluationCases()
  })

  await store.saveCurrent(current)

  const baseline = await store.loadBaseline()

  const comparator = new RegressionComparator()

  const comparison = comparator.compare(baseline, current)

  await store.saveComparison(comparison)

  printResult(current, comparison.passed)

  if (!comparison.passed) {
    for (const regression of comparison.regressions) {
      console.error(
        [
          'REGRESSION',
          regression.caseId,
          regression.field,
          `baseline=${JSON.stringify(regression.baseline)}`,
          `current=${JSON.stringify(regression.current)}`
        ].join(' ')
      )
    }

    process.exitCode = 1
  }
}

function printResult(
  result: Awaited<ReturnType<EvaluationRunner['run']>>,
  comparisonPassed: boolean
): void {
  for (const evaluationCase of result.cases) {
    console.log(
      [
        evaluationCase.passed ? 'PASS' : 'FAIL',

        evaluationCase.id,

        evaluationCase.actual.classification,

        `attempts=${evaluationCase.actual.attempts}`
      ].join(' ')
    )
  }

  console.log('')

  console.log(`Cases: ${result.summary.passed}/${result.summary.total}`)

  console.log(
    `Baseline comparison: ${comparisonPassed ? 'PASSED' : 'FAILED'}`
  )

  console.log(`Prompt versions: ${JSON.stringify(result.promptVersions)}`)
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error
  )

  process.exitCode = 1
})
