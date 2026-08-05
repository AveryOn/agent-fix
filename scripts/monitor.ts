import { MonitoringAggregator } from '../src/application/monitoring/monitoring-aggregator.js'
import { MonitoringSummaryFormatter } from '../src/application/monitoring/monitoring-summary-formatter.js'
import { FileMonitoringSource } from '../src/infra/monitoring/file-monitoring-source.js'
import { env } from '../src/env.js'

async function main(): Promise<void> {
  const source = new FileMonitoringSource({
    runsRoot: env.RUNS_ROOT,
    evaluationsRoot: 'evaluations'
  })

  const [runs, evaluation] = await Promise.all([
    source.loadRuns(),
    source.loadEvaluationSnapshot()
  ])

  const summary = new MonitoringAggregator().aggregate({
    runs,
    evaluation
  })

  console.log(new MonitoringSummaryFormatter().format(summary))
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error
  )

  process.exitCode = 1
})
