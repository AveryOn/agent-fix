import type {
  ExecuteStepInput,
  ExecuteStepResult,
  StepCheckpointStore
} from '~/core/execution'

import { createHash } from 'node:crypto'
import {
  ExecutionError,
  ExecutionErrorCode,
  ExecutionFailureKind
} from '~/core/execution'

export class StepExecutor {
  constructor(private readonly checkpointStore: StepCheckpointStore) {}

  async execute<TInput, TOutput>(
    input: ExecuteStepInput<TInput, TOutput>
  ): Promise<ExecuteStepResult<TOutput>> {
    const inputHash = hashValue(input.input)

    const executionId = createExecutionId(
      input.runId,
      input.step,
      input.attempt,
      inputHash
    )

    const checkpoint = await this.checkpointStore.load<TOutput>(
      input.runId,
      executionId
    )

    if (checkpoint !== null) {
      this.assertValidCheckpoint(
        checkpoint.inputHash,
        inputHash,
        checkpoint.outputHash,
        checkpoint.output
      )

      if (
        input.workspaceRevision !== undefined &&
        checkpoint.workspaceRevision !== null &&
        input.workspaceRevision !== checkpoint.workspaceRevision
      ) {
        throw new ExecutionError(
          `Checkpoint ${executionId} belongs to another workspace revision`,
          ExecutionErrorCode.stale_checkpoint,
          {
            kind: ExecutionFailureKind.non_retryable
          }
        )
      }

      return {
        executionId,
        inputHash,
        outputHash: checkpoint.outputHash,
        resumed: true,
        output: checkpoint.output
      }
    }

    const output = await input.execute()

    const outputHash = hashValue(output)

    await this.checkpointStore.save({
      runId: input.runId,
      step: input.step,
      executionId,
      inputHash,
      outputHash,
      attempt: input.attempt,
      workspaceRevision: input.workspaceRevision ?? null,
      output
    })

    return {
      executionId,
      inputHash,
      outputHash,
      resumed: false,
      output
    }
  }

  private assertValidCheckpoint(
    storedInputHash: string,
    expectedInputHash: string,
    storedOutputHash: string,
    output: unknown
  ): void {
    if (storedInputHash !== expectedInputHash) {
      throw new ExecutionError(
        'Checkpoint input hash does not match current step input',
        ExecutionErrorCode.checkpoint_input_mismatch,
        {
          kind: ExecutionFailureKind.fatal
        }
      )
    }

    if (hashValue(output) !== storedOutputHash) {
      throw new ExecutionError(
        'Checkpoint output hash verification failed',
        ExecutionErrorCode.checkpoint_corrupted,
        {
          kind: ExecutionFailureKind.fatal
        }
      )
    }
  }
}

export function createExecutionId(
  runId: string,
  step: string,
  attempt: number,
  inputHash: string
): string {
  const digest = createHash('sha256')
    .update(runId)
    .update('\0')
    .update(step)
    .update('\0')
    .update(String(attempt))
    .update('\0')
    .update(inputHash)
    .digest('hex')
    .slice(0, 24)

  return `${step}-${digest}`
}

export function hashValue(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(stableSerialize(value))
    .digest('hex')}`
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeValue(value))
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeValue)
  }

  if (typeof value !== 'object' || value === null) {
    return value
  }

  const record = value as Record<string, unknown>

  const result: Record<string, unknown> = {}

  for (const key of Object.keys(record).sort()) {
    const entry = record[key]

    if (entry !== undefined) {
      result[key] = normalizeValue(entry)
    }
  }

  return result
}
