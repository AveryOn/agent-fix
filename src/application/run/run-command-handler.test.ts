import type { CliOutput } from '~/core/cli'
import type { HumanApprovalPrompt, HumanApprovalRequest } from '~/core/run'

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { RunCommandHandler, RunService } from '~/application/run'
import { LogLevel } from '~/core/logging'
import { HumanApprovalDecision, RunStatus } from '~/core/run'
import { TraceRecorder } from '~/core/trace'
import { FileSystemTargetRepositoryValidator } from '~/infra/cli'
import { createPinoLogger } from '~/infra/logging'
import { FileRunStore } from '~/infra/run'
import { JsonlTraceWriter } from '~/infra/trace'

class ApprovedPrompt implements HumanApprovalPrompt {
  requestApproval(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _request: HumanApprovalRequest
  ): Promise<HumanApprovalDecision> {
    return Promise.resolve(HumanApprovalDecision.approved)
  }
}

class MemoryOutput implements CliOutput {
  readonly lines: string[] = []
  readonly errors: string[] = []

  writeLine(message: string): void {
    this.lines.push(message)
  }

  writeError(message: string): void {
    this.errors.push(message)
  }
}

describe('RunCommandHandler', () => {
  it('creates a run, validates the repository and saves approval', async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), 'agent-fix-run-')
    )

    try {
      const repositoryPath = path.join(temporaryRoot, 'repository')

      const runsRoot = path.join(temporaryRoot, 'runs')

      await mkdir(path.join(repositoryPath, '.git'), {
        recursive: true
      })

      const runStore = new FileRunStore(runsRoot)

      const runService = new RunService(
        runStore,
        () => new Date('2026-08-03T19:00:00.000Z'),
        () => 'run-001'
      )

      const traceRecorder = new TraceRecorder(
        new JsonlTraceWriter({
          runsRoot
        }),
        () => new Date('2026-08-03T19:00:00.000Z')
      )

      const output = new MemoryOutput()

      const handler = new RunCommandHandler(
        runService,
        new FileSystemTargetRepositoryValidator(
          () => new Date('2026-08-03T19:00:00.000Z')
        ),
        new ApprovedPrompt(),
        output,
        createPinoLogger({
          level: LogLevel.silent,
          pretty: false
        }),
        traceRecorder
      )

      const exitCode = await handler.execute({
        repositoryPath,
        task: 'Duplicate webhook creates two payments'
      })

      await traceRecorder.flush()

      expect(exitCode).toBe(0)
      expect(output.errors).toEqual([])

      const runDirectory = path.join(runsRoot, 'run-001')

      const state = JSON.parse(
        await readFile(path.join(runDirectory, 'state.json'), 'utf8')
      ) as Record<string, unknown>

      const validation = JSON.parse(
        await readFile(path.join(runDirectory, 'validation.json'), 'utf8')
      ) as Record<string, unknown>

      const events = await readFile(
        path.join(runDirectory, 'events.jsonl'),
        'utf8'
      )

      expect(state).toMatchObject({
        runId: 'run-001',
        status: RunStatus.approved,
        currentStep: null,
        approval: {
          decision: HumanApprovalDecision.approved
        }
      })

      expect(validation).toMatchObject({
        passed: true,
        repositoryPath
      })

      expect(events).toContain('"type":"validation.result"')
    } finally {
      await rm(temporaryRoot, {
        recursive: true,
        force: true
      })
    }
  })
})
