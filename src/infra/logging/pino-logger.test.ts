import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { LogLevel } from '~/core/logging'
import { createPinoLogger } from '~/infra/logging'

describe('PinoLogger', () => {
  it('writes structured context and redacts sensitive data', () => {
    const chunks: string[] = []

    const destination = new Writable({
      write(chunk, _encoding, callback) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call
        chunks.push(chunk.toString())
        callback()
      }
    })

    const logger = createPinoLogger({
      level: LogLevel.info,
      pretty: false,
      destination
    })

    const runLogger = logger.child({
      runId: 'run-001',
      step: 'investigation',
      agent: 'investigator',
      attempt: 2,
      workspaceRevision: 'abc123'
    })

    runLogger.info('Agent started', {
      OPENAI_API_KEY: 'secret-api-key',
      systemPrompt: 'private prompt',
      safeValue: 'visible'
    })

    logger.flush()

    const record = JSON.parse(chunks.join('').trim()) as Record<
      string,
      unknown
    >

    expect(record).toMatchObject({
      service: 'AgentFix',
      runId: 'run-001',
      step: 'investigation',
      agent: 'investigator',
      attempt: 2,
      workspaceRevision: 'abc123',
      safeValue: 'visible',
      msg: 'Agent started'
    })

    expect(record.OPENAI_API_KEY).toBe('[REDACTED_SECRET]')
    expect(record.systemPrompt).toBe('[REDACTED_PROMPT]')
  })
})
