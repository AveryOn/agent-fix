import type { MonitoringSummary } from '~/core/monitoring'

export class MonitoringSummaryFormatter {
  format(summary: MonitoringSummary): string {
    return [
      'AgentFix Monitoring Summary',
      '',
      `Generated: ${summary.generatedAt}`,
      `Runs discovered: ${summary.runCount}`,
      `Terminal runs: ${summary.terminalRunCount}`,
      '',
      'Primary degradation metric',
      `  firstAttemptValidationPassRate: ${formatRate(
        summary.firstAttemptValidationPassRate
      )}`,
      '',
      'Run outcomes',
      `  successfulRunCount: ${summary.successfulRunCount}`,
      `  failedRunCount: ${summary.failedRunCount}`,
      `  runSuccessRate: ${formatRate(summary.runSuccessRate)}`,
      `  runFailureRate: ${formatRate(summary.runFailureRate)}`,
      '',
      'Validation',
      `  validationFailureRate: ${formatRate(
        summary.validationFailureRate
      )}`,
      `  validationRejectionRate: ${formatRate(
        summary.validationRejectionRate
      )}`,
      '',
      'Retries',
      `  retryRate: ${formatRate(summary.retryRate)}`,
      `  averageAttemptsPerSuccessfulRun: ${formatNumber(
        summary.averageAttemptsPerSuccessfulRun
      )}`,
      `  averageRetriesPerSuccessfulRun: ${formatNumber(
        summary.averageRetriesPerSuccessfulRun
      )}`,
      '',
      'Token usage and cost',
      `  totalInputTokens: ${summary.totalInputTokens}`,
      `  totalOutputTokens: ${summary.totalOutputTokens}`,
      `  totalTokens: ${summary.totalTokens}`,
      `  tokensPerSuccessfulRun: ${formatNullableNumber(
        summary.tokensPerSuccessfulRun
      )}`,
      `  totalEstimatedCostUsd: ${formatCost(
        summary.totalEstimatedCostUsd
      )}`,
      `  tokenCostPerSuccessfulRun: ${formatCost(
        summary.tokenCostPerSuccessfulRun
      )}`,
      '',
      'Latency',
      `  averageRunLatencyMs: ${formatNullableNumber(
        summary.averageRunLatencyMs
      )}`,
      `  p50RunLatencyMs: ${formatNullableNumber(
        summary.p50RunLatencyMs
      )}`,
      `  p95RunLatencyMs: ${formatNullableNumber(
        summary.p95RunLatencyMs
      )}`,
      '',
      'Evaluation',
      `  evaluationRegressionRate: ${formatRate(
        summary.evaluationRegressionRate
      )}`
    ].join('\n')
  }
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

function formatNumber(value: number): string {
  return value.toFixed(2)
}

function formatNullableNumber(value: number | null): string {
  return value === null ? 'unavailable' : value.toFixed(2)
}

function formatCost(value: number | null): string {
  return value === null ? 'unavailable' : `$${value.toFixed(6)}`
}
