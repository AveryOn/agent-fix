import type { TraceEventData, TraceWriter } from '~/core/trace'

export interface TraceUsageSummary {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly estimatedCostUsd: number | null
}

interface MutableTraceUsageSummary {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number
  hasEstimatedCost: boolean
}

export class TraceRecorder {
  private readonly usageByRun = new Map<string, MutableTraceUsageSummary>()

  constructor(
    private readonly writer: TraceWriter,
    private readonly now: () => Date = () => new Date()
  ) {}

  record(event: TraceEventData): Promise<void> {
    this.recordUsage(event)

    return this.writer.write({
      timestamp: this.now().toISOString(),
      ...event
    })
  }

  getUsageSummary(runId: string): TraceUsageSummary {
    const usage = this.usageByRun.get(runId)

    if (usage === undefined) {
      return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: null
      }
    }

    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      estimatedCostUsd: usage.hasEstimatedCost
        ? usage.estimatedCostUsd
        : null
    }
  }

  flush(): Promise<void> {
    return this.writer.flush()
  }

  private recordUsage(event: TraceEventData): void {
    if (
      event.tokenUsage === undefined &&
      event.estimatedCostUsd === undefined
    ) {
      return
    }

    const usage = this.usageByRun.get(event.runId) ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      hasEstimatedCost: false
    }

    if (event.tokenUsage !== undefined) {
      usage.inputTokens += event.tokenUsage.inputTokens

      usage.outputTokens += event.tokenUsage.outputTokens

      usage.totalTokens += event.tokenUsage.totalTokens
    }

    if (event.estimatedCostUsd !== undefined) {
      usage.estimatedCostUsd += event.estimatedCostUsd

      usage.hasEstimatedCost = true
    }

    this.usageByRun.set(event.runId, usage)
  }
}
