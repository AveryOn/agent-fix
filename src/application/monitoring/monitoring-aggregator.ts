import type {
  MonitoringInput,
  MonitoringRunRecord,
  MonitoringSummary
} from '~/core/monitoring'
import type { TraceEvent } from '~/core/trace'

import { MonitoringTerminalStatus } from '~/core/monitoring'
import { TraceEventType } from '~/core/trace'

const mechanicalValidationStep = 'mechanical_validation'

export class MonitoringAggregator {
  aggregate(input: MonitoringInput): MonitoringSummary {
    const terminalRuns = input.runs.filter(isTerminalRun)

    const successfulRuns = terminalRuns.filter(
      (run) => run.state.status === MonitoringTerminalStatus.completed
    )

    const failedRuns = terminalRuns.filter(
      (run) => run.state.status !== MonitoringTerminalStatus.completed
    )

    const validationRuns = terminalRuns.filter(hasMechanicalValidation)

    const firstAttemptValidationPasses = validationRuns.filter(
      passedMechanicalValidationOnFirstAttempt
    )

    const validationFailures = validationRuns.filter(
      (run) => !passedMechanicalValidation(run)
    )

    const retriedRuns = terminalRuns.filter(
      (run) => getRetryCount(run) > 0
    )

    const successfulRetryCount = successfulRuns.reduce(
      (total, run) => total + getRetryCount(run),
      0
    )

    const successfulAttemptCount = successfulRuns.reduce(
      (total, run) => total + getAttemptCount(run),
      0
    )

    const tokenUsage = aggregateTokenUsage(terminalRuns)

    const successfulTokenUsage = aggregateTokenUsage(successfulRuns)

    const latencies = terminalRuns
      .map(getRunLatencyMs)
      .filter((latency): latency is number => latency !== null)
      .sort((left, right) => left - right)

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),

      runCount: input.runs.length,
      terminalRunCount: terminalRuns.length,
      successfulRunCount: successfulRuns.length,
      failedRunCount: failedRuns.length,

      runSuccessRate: divide(successfulRuns.length, terminalRuns.length),

      runFailureRate: divide(failedRuns.length, terminalRuns.length),

      firstAttemptValidationPassRate: divide(
        firstAttemptValidationPasses.length,
        validationRuns.length
      ),

      validationFailureRate: divide(
        validationFailures.length,
        validationRuns.length
      ),

      validationRejectionRate: divide(
        validationFailures.length,
        validationRuns.length
      ),

      retryRate: divide(retriedRuns.length, terminalRuns.length),

      averageAttemptsPerSuccessfulRun: divide(
        successfulAttemptCount,
        successfulRuns.length
      ),

      averageRetriesPerSuccessfulRun: divide(
        successfulRetryCount,
        successfulRuns.length
      ),

      totalInputTokens: tokenUsage.inputTokens,
      totalOutputTokens: tokenUsage.outputTokens,
      totalTokens: tokenUsage.totalTokens,
      totalEstimatedCostUsd: tokenUsage.hasEstimatedCost
        ? tokenUsage.estimatedCostUsd
        : null,

      tokensPerSuccessfulRun:
        successfulRuns.length === 0
          ? null
          : successfulTokenUsage.totalTokens / successfulRuns.length,

      tokenCostPerSuccessfulRun:
        successfulRuns.length === 0 ||
        !successfulTokenUsage.hasEstimatedCost
          ? null
          : successfulTokenUsage.estimatedCostUsd / successfulRuns.length,

      averageRunLatencyMs:
        latencies.length === 0 ? null : average(latencies),

      p50RunLatencyMs: percentile(latencies, 0.5),
      p95RunLatencyMs: percentile(latencies, 0.95),

      evaluationRegressionRate: divide(
        input.evaluation.regressionCount,
        input.evaluation.totalCases
      )
    }
  }
}

interface TokenUsageSummary {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly estimatedCostUsd: number
  readonly hasEstimatedCost: boolean
}

function isTerminalRun(run: MonitoringRunRecord): boolean {
  return Object.values(MonitoringTerminalStatus).includes(
    run.state.status as MonitoringTerminalStatus
  )
}

function hasMechanicalValidation(run: MonitoringRunRecord): boolean {
  return run.events.some(
    (event) =>
      event.type === TraceEventType.validation_result &&
      event.step === mechanicalValidationStep
  )
}

function passedMechanicalValidation(run: MonitoringRunRecord): boolean {
  const event = getLastMechanicalValidationEvent(run)

  return event === null ? false : getValidationPassed(event.output)
}

function passedMechanicalValidationOnFirstAttempt(
  run: MonitoringRunRecord
): boolean {
  const event = getFirstMechanicalValidationEvent(run)

  if (event === null || !getValidationPassed(event.output)) {
    return false
  }

  return !run.events.some(
    (candidate) =>
      candidate.type === TraceEventType.retry &&
      candidate.step === mechanicalValidationStep &&
      candidate.timestamp <= event.timestamp
  )
}

function getFirstMechanicalValidationEvent(
  run: MonitoringRunRecord
): TraceEvent | null {
  return (
    run.events.find(
      (event) =>
        event.type === TraceEventType.validation_result &&
        event.step === mechanicalValidationStep
    ) ?? null
  )
}

function getLastMechanicalValidationEvent(
  run: MonitoringRunRecord
): TraceEvent | null {
  const matchingEvents = run.events.filter(
    (event) =>
      event.type === TraceEventType.validation_result &&
      event.step === mechanicalValidationStep
  )

  return matchingEvents.at(-1) ?? null
}

function getValidationPassed(output: unknown): boolean {
  if (typeof output !== 'object' || output === null) {
    return false
  }

  if ('passed' in output && typeof output.passed === 'boolean') {
    return output.passed
  }

  if (
    'report' in output &&
    typeof output.report === 'object' &&
    output.report !== null &&
    'passed' in output.report &&
    typeof output.report.passed === 'boolean'
  ) {
    return output.report.passed
  }

  return false
}

function getRetryCount(run: MonitoringRunRecord): number {
  return run.events.filter((event) => event.type === TraceEventType.retry)
    .length
}

function getAttemptCount(run: MonitoringRunRecord): number {
  const attemptsByStep = new Map<string, number>()

  for (const event of run.events) {
    if (event.attempt === undefined) {
      continue
    }

    const current = attemptsByStep.get(event.step) ?? 0

    attemptsByStep.set(event.step, Math.max(current, event.attempt))
  }

  if (attemptsByStep.size > 0) {
    return [...attemptsByStep.values()].reduce(
      (total, attempts) => total + attempts,
      0
    )
  }

  const agentSteps = new Set(
    run.events
      .filter((event) => event.type === TraceEventType.agent_call)
      .map((event) => event.step)
  )

  return agentSteps.size
}

function aggregateTokenUsage(
  runs: readonly MonitoringRunRecord[]
): TokenUsageSummary {
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let estimatedCostUsd = 0
  let hasEstimatedCost = false

  for (const run of runs) {
    for (const event of run.events) {
      if (event.tokenUsage !== undefined) {
        inputTokens += event.tokenUsage.inputTokens
        outputTokens += event.tokenUsage.outputTokens
        totalTokens += event.tokenUsage.totalTokens
      }

      if (event.estimatedCostUsd !== undefined) {
        estimatedCostUsd += event.estimatedCostUsd
        hasEstimatedCost = true
      }
    }
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd,
    hasEstimatedCost
  }
}

function getRunLatencyMs(run: MonitoringRunRecord): number | null {
  const createdAt = Date.parse(run.state.createdAt)
  const updatedAt = Date.parse(run.state.updatedAt)

  if (
    !Number.isFinite(createdAt) ||
    !Number.isFinite(updatedAt) ||
    updatedAt < createdAt
  ) {
    return null
  }

  return updatedAt - createdAt
}

function divide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

function percentile(
  sortedValues: readonly number[],
  quantile: number
): number | null {
  if (sortedValues.length === 0) {
    return null
  }

  const index = Math.ceil(quantile * sortedValues.length) - 1

  return (
    sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))] ??
    null
  )
}
