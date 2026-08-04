import type {
  ProcessCommandResult,
  ProcessResultArtifact,
  ProcessResultStore
} from '~/core/process'

import { randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ProcessRunnerError, ProcessRunnerErrorCode } from '~/core/process'

const validIdentifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export class FileProcessResultStore implements ProcessResultStore {
  private readonly runsRoot: string

  constructor(runsRoot: string) {
    this.runsRoot = path.resolve(runsRoot)
  }

  async save(
    runId: string,
    result: ProcessCommandResult
  ): Promise<ProcessResultArtifact> {
    assertValidIdentifier(runId, 'run')
    assertValidIdentifier(result.executionId, 'execution')

    if (result.runId !== runId) {
      throw new ProcessRunnerError(
        `Command result belongs to run ${result.runId}, expected ${runId}`,
        ProcessRunnerErrorCode.invalid_run
      )
    }

    const commandsDirectory = path.join(this.runsRoot, runId, 'commands')

    await mkdir(commandsDirectory, {
      recursive: true
    })

    const fileName = `${result.executionId}.json`
    const filePath = path.join(commandsDirectory, fileName)

    await this.writeJsonAtomic(filePath, result)

    return {
      id: result.executionId,
      type: 'command.result',
      relativePath: path.posix.join('commands', fileName)
    }
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

function assertValidIdentifier(value: string, kind: string): void {
  if (!validIdentifierPattern.test(value)) {
    throw new ProcessRunnerError(
      `Invalid ${kind} identifier: ${value}`,
      ProcessRunnerErrorCode.invalid_run
    )
  }
}
