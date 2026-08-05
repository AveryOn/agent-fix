import type {
  MonitoringInput,
  MonitoringRunRecord
} from '~/core/monitoring'
import type { TraceEvent } from '~/core/trace'

import { describe, expect, it } from 'vitest'
import { MonitoringAggregator } from '~/application/monitoring'
import { TraceEventType } from '~/core/trace'

describe('MonitoringAggregator', () => {
  it('calculates run, validation, retry, token and latency metrics', () => {
    const input: MonitoringInput = {
      runs: [
        createRun({
          runId: 'run-001',
          status: 'completed',
          createdAt: '2026-08-05T10:00:00.000Z',
          updatedAt: '2026-08-05T10:00:10.000Z',
          events: [
            createEvent({
              runId: 'run-001',
              step: 'investigator',
              type: TraceEventType.agent_call,
              attempt: 1,
              durationMs: 1000,
              tokenUsage: {
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 150
              },
              estimatedCostUsd: 0.01
            }),

            createEvent({
              runId: 'run-001',
              step: 'validation',
              type: TraceEventType.validation_result,
              output: {
                report: {
                  passed: true
                }
              }
            })
          ]
        }),

        createRun({
          runId: 'run-002',
          status: 'failed',
          createdAt: '2026-08-05T11:00:00.000Z',
          updatedAt: '2026-08-05T11:00:20.000Z',
          events: [
            createEvent({
              runId: 'run-002',
              step: 'implementer',
              type: TraceEventType.retry,
              attempt: 1
            }),

            createEvent({
              runId: 'run-002',
              step: 'validation',
              type: TraceEventType.validation_result,
              output: {
                report: {
                  passed: false
                }
              }
            })
          ]
        })
      ],

      evaluation: {
        totalCases: 10,
        regressionCount: 2
      }
    }

    const summary = new MonitoringAggregator().aggregate(input)

    expect(summary.runSuccessRate).toBe(0.5)
    expect(summary.runFailureRate).toBe(0.5)

    expect(summary.firstAttemptValidationPassRate).toBe(0.5)

    expect(summary.validationFailureRate).toBe(0.5)
    expect(summary.retryRate).toBe(0.5)

    expect(summary.averageRetriesPerSuccessfulRun).toBe(0)

    expect(summary.totalTokens).toBe(150)

    expect(summary.tokenCostPerSuccessfulRun).toBe(0.01)

    expect(summary.averageRunLatencyMs).toBe(15000)
    expect(summary.p50RunLatencyMs).toBe(10000)
    expect(summary.p95RunLatencyMs).toBe(20000)

    expect(summary.evaluationRegressionRate).toBe(0.2)
  })

  it('returns stable zero and null metrics without runs', () => {
    const summary = new MonitoringAggregator().aggregate({
      runs: [],
      evaluation: {
        totalCases: 0,
        regressionCount: 0
      }
    })

    expect(summary.runSuccessRate).toBe(0)

    expect(summary.firstAttemptValidationPassRate).toBe(0)

    expect(summary.tokenCostPerSuccessfulRun).toBeNull()
    expect(summary.averageRunLatencyMs).toBeNull()
    expect(summary.p50RunLatencyMs).toBeNull()
    expect(summary.p95RunLatencyMs).toBeNull()
  })
})

function createRun(input: {
  readonly runId: string
  readonly status: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly events: readonly TraceEvent[]
}): MonitoringRunRecord {
  return {
    state: {
      runId: input.runId,
      status: input.status,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt
    },

    events: input.events
  }
}

function createEvent(
  overrides: Partial<TraceEvent> & {
    readonly runId: string
    readonly step: string
    readonly type: TraceEventType
  }
): TraceEvent {
  return {
    timestamp: '2026-08-05T10:00:01.000Z',
    ...overrides,
    runId: overrides.runId,
    step: overrides.step,
    type: overrides.type
  }
}
