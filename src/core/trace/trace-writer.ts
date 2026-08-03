import type { TraceEvent } from '~/core/trace/trace-event'

export interface TraceWriter {
  write(event: TraceEvent): Promise<void>
  flush(): Promise<void>
}
