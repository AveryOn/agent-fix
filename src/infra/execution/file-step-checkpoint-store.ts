import type {
  SaveStepCheckpointInput,
  StepCheckpoint,
  StepCheckpointStore
} from '~/core/execution'

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const validIdentifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export class FileStepCheckpointStore implements StepCheckpointStore {
  private readonly runsRoot: string

  constructor(runsRoot: string) {
    this.runsRoot = path.resolve(runsRoot)
  }

  async load<T>(executionId: string): Promise<StepCheckpoint<T> | null> {
    assertValidIdentifier(executionId)

    const matches = await this.findCheckpoint(executionId)

    if (matches === null) {
      return null
    }

    const content = await readFile(matches, 'utf8')

    return JSON.parse(content) as StepCheckpoint<T>
  }

  async save<T>(
    input: SaveStepCheckpointInput<T>
  ): Promise<StepCheckpoint<T>> {
    assertValidIdentifier(input.runId)
    assertValidIdentifier(input.executionId)

    const checkpoint: StepCheckpoint<T> = {
      schemaVersion: 1,
      runId: input.runId,
      step: input.step,
      executionId: input.executionId,
      inputHash: input.inputHash,
      outputHash: input.outputHash,
      attempt: input.attempt,
      workspaceRevision: input.workspaceRevision,
      createdAt: new Date().toISOString(),
      output: input.output
    }

    const directory = path.join(this.runsRoot, input.runId, 'checkpoints')

    await mkdir(directory, {
      recursive: true
    })

    const filePath = path.join(directory, `${input.executionId}.json`)

    const temporaryPath = `${filePath}.${randomUUID()}.tmp`

    await writeFile(
      temporaryPath,
      `${JSON.stringify(checkpoint, null, 2)}\n`,
      'utf8'
    )

    await rename(temporaryPath, filePath)

    return checkpoint
  }

  private async findCheckpoint(
    executionId: string
  ): Promise<string | null> {
    const runsDirectory = await import('node:fs/promises').then(
      ({ readdir }) =>
        readdir(this.runsRoot, {
          withFileTypes: true
        }).catch(() => [])
    )

    for (const entry of runsDirectory) {
      if (!entry.isDirectory()) {
        continue
      }

      const filePath = path.join(
        this.runsRoot,
        entry.name,
        'checkpoints',
        `${executionId}.json`
      )

      const exists = await import('node:fs/promises').then(({ stat }) =>
        stat(filePath)
          .then((result) => result.isFile())
          .catch(() => false)
      )

      if (exists) {
        return filePath
      }
    }

    return null
  }
}

function assertValidIdentifier(value: string): void {
  if (!validIdentifierPattern.test(value)) {
    throw new Error(`Invalid execution identifier: ${value}`)
  }
}
