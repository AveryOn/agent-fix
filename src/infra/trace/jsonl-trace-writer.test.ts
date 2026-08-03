import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TraceEventType, TraceRecorder } from '~/core/trace'
import { JsonlTraceWriter } from '~/infra/trace'

describe('JsonlTraceWriter', () => {
  it('writes ordered and redacted trace events', async () => {
    const runsRoot = await mkdtemp(path.join(tmpdir(), 'agent-fix-trace-'))

    try {
      const writer = new JsonlTraceWriter({
        runsRoot
      })

      const recorder = new TraceRecorder(
        writer,
        () => new Date('2026-08-03T18:00:00.000Z')
      )

      const eventTypes = Object.values(TraceEventType)

      await Promise.all(
        eventTypes.map((type, index) =>
          recorder.record({
            runId: 'run-001',
            step: `step-${index + 1}`,
            agent: 'investigator',
            attempt: 1,
            workspaceRevision: 'abc123',
            type,
            input: {
              OPENAI_API_KEY: 'secret-api-key',
              systemPrompt: 'private prompt',
              safeValue: 'visible'
            },
            promptVersion: 'investigator-v1',
            durationMs: 100,
            tokenUsage: {
              inputTokens: 20,
              outputTokens: 10,
              totalTokens: 30
            },
            estimatedCostUsd: 0.001
          })
        )
      )

      await recorder.flush()

      const content = await readFile(
        path.join(runsRoot, 'run-001', 'events.jsonl'),
        'utf8'
      )

      const events = content
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)

      expect(events).toHaveLength(eventTypes.length)
      expect(events.map((event) => event.type)).toEqual(eventTypes)

      expect(events[0]).toMatchObject({
        timestamp: '2026-08-03T18:00:00.000Z',
        runId: 'run-001',
        step: 'step-1',
        agent: 'investigator',
        attempt: 1,
        workspaceRevision: 'abc123',
        promptVersion: 'investigator-v1',
        durationMs: 100,
        estimatedCostUsd: 0.001,
        tokenUsage: {
          inputTokens: 20,
          outputTokens: 10,
          totalTokens: 30
        },
        input: {
          OPENAI_API_KEY: '[REDACTED_SECRET]',
          systemPrompt: '[REDACTED_PROMPT]',
          safeValue: 'visible'
        }
      })
    } finally {
      await rm(runsRoot, {
        recursive: true,
        force: true
      })
    }
  })

  it('rejects an unsafe run identifier', async () => {
    const runsRoot = await mkdtemp(path.join(tmpdir(), 'agent-fix-trace-'))

    try {
      const writer = new JsonlTraceWriter({
        runsRoot
      })

      const recorder = new TraceRecorder(writer)

      await expect(
        recorder.record({
          runId: '../outside',
          step: 'test',
          type: TraceEventType.failure
        })
      ).rejects.toThrow('Invalid trace run identifier')
    } finally {
      await rm(runsRoot, {
        recursive: true,
        force: true
      })
    }
  })
})
