import type { TraceEvent, TraceWriter } from '~/core/trace'

import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { redactSensitiveData } from '~/core/observability'

const validRunIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export interface JsonlTraceWriterOptions {
  readonly runsRoot: string
  readonly fileName?: string
}

export class JsonlTraceWriter implements TraceWriter {
  private readonly runsRoot: string
  private readonly fileName: string
  private queue: Promise<void> = Promise.resolve()

  constructor(options: JsonlTraceWriterOptions) {
    this.runsRoot = path.resolve(options.runsRoot)
    this.fileName = options.fileName ?? 'events.jsonl'
  }

  write(event: TraceEvent): Promise<void> {
    const operation = this.queue.then(() => this.append(event))

    this.queue = operation.catch(() => undefined)

    return operation
  }

  flush(): Promise<void> {
    return this.queue
  }

  private async append(event: TraceEvent): Promise<void> {
    assertValidRunId(event.runId)

    const runDirectory = path.join(this.runsRoot, event.runId)
    const traceFile = path.join(runDirectory, this.fileName)

    await mkdir(runDirectory, {
      recursive: true
    })

    const redactedEvent = redactSensitiveData(event)
    const line = `${JSON.stringify(redactedEvent)}\n`

    await appendFile(traceFile, line, 'utf8')
  }
}

function assertValidRunId(runId: string): void {
  if (!validRunIdPattern.test(runId)) {
    throw new Error(`Invalid trace run identifier: ${runId}`)
  }
}
