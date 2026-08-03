import type { TraceEventData, TraceWriter } from '~/core/trace'

export class TraceRecorder {
  constructor(
    private readonly writer: TraceWriter,
    private readonly now: () => Date = () => new Date()
  ) {}

  record(event: TraceEventData): Promise<void> {
    return this.writer.write({
      timestamp: this.now().toISOString(),
      ...event
    })
  }

  flush(): Promise<void> {
    return this.writer.flush()
  }
}
