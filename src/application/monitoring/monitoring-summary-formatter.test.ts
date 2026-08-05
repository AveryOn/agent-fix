import { describe, expect, it } from 'vitest'
import { MonitoringSummaryFormatter } from '~/application/monitoring'

describe('MonitoringSummaryFormatter', () => {
  it('prints the primary degradation metric', () => {
    const output = new MonitoringSummaryFormatter().format({
      schemaVersion: 1,
      generatedAt: '2026-08-05T12:00:00.000Z',

      runCount: 2,
      terminalRunCount: 2,
      successfulRunCount: 1,
      failedRunCount: 1,

      runSuccessRate: 0.5,
      runFailureRate: 0.5,

      firstAttemptValidationPassRate: 0.75,
      validationFailureRate: 0.25,
      validationRejectionRate: 0.25,

      retryRate: 0.5,
      averageAttemptsPerSuccessfulRun: 4,
      averageRetriesPerSuccessfulRun: 1,

      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalTokens: 150,
      totalEstimatedCostUsd: 0.01,

      tokensPerSuccessfulRun: 150,
      tokenCostPerSuccessfulRun: 0.01,

      averageRunLatencyMs: 1000,
      p50RunLatencyMs: 900,
      p95RunLatencyMs: 1500,

      evaluationRegressionRate: 0
    })

    expect(output).toContain('firstAttemptValidationPassRate: 75.00%')

    expect(output).toContain('tokenCostPerSuccessfulRun: $0.010000')

    expect(output).toContain('p95RunLatencyMs: 1500.00')
  })
})
