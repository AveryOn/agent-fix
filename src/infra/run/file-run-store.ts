import type {
  CreateRunStoreInput,
  RunState,
  RunStore,
  RunValidationReport
} from '~/core/run'

import { randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const validRunIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

const runDirectories = ['workspace', 'commands', 'agents', 'patches']

export class FileRunStore implements RunStore {
  private readonly runsRoot: string

  constructor(runsRoot: string) {
    this.runsRoot = path.resolve(runsRoot)
  }

  getRunDirectory(runId: string): string {
    assertValidRunId(runId)

    return path.join(this.runsRoot, runId)
  }

  async create(input: CreateRunStoreInput): Promise<void> {
    const runDirectory = this.getRunDirectory(input.state.runId)

    await mkdir(this.runsRoot, {
      recursive: true
    })

    await mkdir(runDirectory, {
      recursive: false
    })

    await Promise.all(
      runDirectories.map((directory) =>
        mkdir(path.join(runDirectory, directory))
      )
    )

    await writeFile(path.join(runDirectory, 'events.jsonl'), '', {
      encoding: 'utf8',
      flag: 'wx'
    })

    await this.writeJsonAtomic(
      path.join(runDirectory, 'state.json'),
      input.state
    )
  }

  saveState(state: RunState): Promise<void> {
    return this.writeJsonAtomic(
      path.join(this.getRunDirectory(state.runId), 'state.json'),
      state
    )
  }

  saveValidation(
    runId: string,
    report: RunValidationReport
  ): Promise<void> {
    return this.writeJsonAtomic(
      path.join(this.getRunDirectory(runId), 'validation.json'),
      report
    )
  }

  private async writeJsonAtomic(
    filePath: string,
    value: unknown
  ): Promise<void> {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`

    await writeFile(
      temporaryPath,
      `${JSON.stringify(value, null, 2)}\n`,
      'utf8'
    )

    await rename(temporaryPath, filePath)
  }
}

function assertValidRunId(runId: string): void {
  if (!validRunIdPattern.test(runId)) {
    throw new Error(`Invalid run identifier: ${runId}`)
  }
}
