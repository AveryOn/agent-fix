import type { TraceEvent } from '~/core/trace'

export const MonitoringTerminalStatus = {
  completed: 'completed',
  failed: 'failed',
  rejected: 'rejected',
  rolled_back: 'rolled_back'
} as const

export type MonitoringTerminalStatus =
  (typeof MonitoringTerminalStatus)[keyof typeof MonitoringTerminalStatus]

export interface MonitoringRunState {
  readonly runId: string
  readonly status: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface MonitoringRunRecord {
  readonly state: MonitoringRunState
  readonly events: readonly TraceEvent[]
}

export interface EvaluationMonitoringSnapshot {
  readonly totalCases: number
  readonly regressionCount: number
}

export interface MonitoringInput {
  readonly runs: readonly MonitoringRunRecord[]
  readonly evaluation: EvaluationMonitoringSnapshot
}

export interface MonitoringSummary {
  readonly schemaVersion: 1
  readonly generatedAt: string

  readonly runCount: number
  readonly terminalRunCount: number
  readonly successfulRunCount: number
  readonly failedRunCount: number

  readonly runSuccessRate: number
  readonly runFailureRate: number

  readonly firstAttemptValidationPassRate: number
  readonly validationFailureRate: number
  readonly validationRejectionRate: number

  readonly retryRate: number
  readonly averageAttemptsPerSuccessfulRun: number
  readonly averageRetriesPerSuccessfulRun: number

  readonly totalInputTokens: number
  readonly totalOutputTokens: number
  readonly totalTokens: number
  readonly totalEstimatedCostUsd: number | null

  readonly tokensPerSuccessfulRun: number | null
  readonly tokenCostPerSuccessfulRun: number | null

  readonly averageRunLatencyMs: number | null
  readonly p50RunLatencyMs: number | null
  readonly p95RunLatencyMs: number | null

  readonly evaluationRegressionRate: number
}

export interface MonitoringSource {
  loadRuns(): Promise<readonly MonitoringRunRecord[]>

  loadEvaluationSnapshot(): Promise<EvaluationMonitoringSnapshot>
}
