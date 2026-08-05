import type {
  SaveStepCheckpointInput,
  StepCheckpoint,
  StepCheckpointStore
} from '~/core/execution'

import { describe, expect, it } from 'vitest'
import {
  StepExecutor,
  createExecutionId,
  hashValue
} from '~/application/execution'

class MemoryCheckpointStore implements StepCheckpointStore {
  readonly checkpoints = new Map<string, StepCheckpoint<unknown>>()

  load<T>(
    runId: string,
    executionId: string
  ): Promise<StepCheckpoint<T> | null> {
    const checkpoint = this.checkpoints.get(`${runId}:${executionId}`)

    return Promise.resolve(
      (checkpoint as StepCheckpoint<T> | undefined) ?? null
    )
  }

  save<T>(input: SaveStepCheckpointInput<T>): Promise<StepCheckpoint<T>> {
    const checkpoint: StepCheckpoint<T> = {
      schemaVersion: 1,
      runId: input.runId,
      step: input.step,
      executionId: input.executionId,
      inputHash: input.inputHash,
      outputHash: input.outputHash,
      attempt: input.attempt,
      workspaceRevision: input.workspaceRevision,
      createdAt: '2026-08-05T09:00:00.000Z',
      output: input.output
    }

    this.checkpoints.set(`${input.runId}:${input.executionId}`, checkpoint)

    return Promise.resolve(checkpoint)
  }
}

describe('StepExecutor', () => {
  it('assigns a deterministic execution identifier', async () => {
    const store = new MemoryCheckpointStore()

    const executor = new StepExecutor(store)

    const input = {
      runId: 'run-001',
      step: 'investigator',
      attempt: 1,
      input: {
        task: 'Fix duplicate payment'
      },
      execute: () =>
        Promise.resolve({
          hypothesis: 'Duplicate insert'
        })
    }

    const first = await executor.execute(input)

    const second = await executor.execute(input)

    expect(first.executionId).toBe(second.executionId)
  })

  it('saves input and output hashes', async () => {
    const store = new MemoryCheckpointStore()

    const executor = new StepExecutor(store)

    const result = await executor.execute({
      runId: 'run-001',
      step: 'investigator',
      attempt: 1,
      input: {
        task: 'Fix duplicate payment'
      },
      execute: () =>
        Promise.resolve({
          hypothesis: 'Duplicate insert'
        })
    })

    expect(result.inputHash).toBe(
      hashValue({
        task: 'Fix duplicate payment'
      })
    )

    expect(result.outputHash).toBe(
      hashValue({
        hypothesis: 'Duplicate insert'
      })
    )
  })

  it('resumes from a valid checkpoint', async () => {
    const store = new MemoryCheckpointStore()

    const executor = new StepExecutor(store)

    let executions = 0

    const input = {
      runId: 'run-001',
      step: 'investigator',
      attempt: 1,
      input: {
        task: 'Fix duplicate payment'
      },
      execute: () => {
        executions += 1

        return Promise.resolve({
          hypothesis: 'Duplicate insert'
        })
      }
    }

    await executor.execute(input)

    const resumed = await executor.execute(input)

    expect(resumed.resumed).toBe(true)
    expect(executions).toBe(1)
  })

  it('creates stable identifiers', () => {
    const inputHash = hashValue({
      task: 'Fix duplicate payment'
    })

    expect(
      createExecutionId('run-001', 'investigator', 1, inputHash)
    ).toBe(createExecutionId('run-001', 'investigator', 1, inputHash))
  })
})
