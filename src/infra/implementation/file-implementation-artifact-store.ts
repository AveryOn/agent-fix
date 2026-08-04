import type {
  ImplementationArtifactStore,
  SaveImplementationArtifactsInput,
  StoredImplementationArtifacts
} from '~/core/implementation'

import { randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  ImplementerError,
  ImplementerErrorCode
} from '~/core/implementation'

const validIdentifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export class FileImplementationArtifactStore implements ImplementationArtifactStore {
  private readonly runsRoot: string

  constructor(
    runsRoot: string,
    private readonly now: () => Date = () => new Date()
  ) {
    this.runsRoot = path.resolve(runsRoot)
  }

  async save(
    input: SaveImplementationArtifactsInput
  ): Promise<StoredImplementationArtifacts> {
    assertValidIdentifier(input.runId, 'run')

    assertValidIdentifier(input.commandResult.executionId, 'execution')

    if (input.commandResult.runId !== input.runId) {
      throw new ImplementerError(
        'Implementation command result belongs to another run',
        ImplementerErrorCode.test_execution_failed
      )
    }

    if (
      input.commandResult.workspaceRevision !== input.workspaceRevision
    ) {
      throw new ImplementerError(
        'Implementation command result belongs to a stale workspace',
        ImplementerErrorCode.stale_workspace
      )
    }

    const suffix = input.commandResult.executionId

    const patchFileName = `implementation-${suffix}.diff`

    const resultFileName = `implementation-${suffix}.json`

    const patchRelativePath = path.posix.join('patches', patchFileName)

    const resultRelativePath = path.posix.join('agents', resultFileName)

    const patchDirectory = path.join(this.runsRoot, input.runId, 'patches')

    const agentDirectory = path.join(this.runsRoot, input.runId, 'agents')

    await Promise.all([
      mkdir(patchDirectory, {
        recursive: true
      }),

      mkdir(agentDirectory, {
        recursive: true
      })
    ])

    const patchArtifact = {
      id: `implementation-patch-${suffix}`,
      type: 'implementation.patch',
      relativePath: patchRelativePath
    } as const

    const implementationArtifact = {
      id: `implementation-result-${suffix}`,
      type: 'implementation.result',
      relativePath: resultRelativePath
    } as const

    await this.writeAtomic(
      path.join(patchDirectory, patchFileName),
      ensureTrailingNewline(input.plan.patch)
    )

    await this.writeJsonAtomic(path.join(agentDirectory, resultFileName), {
      schemaVersion: 1,

      createdAt: this.now().toISOString(),

      runId: input.runId,

      sourceWorkspaceRevision: input.sourceWorkspaceRevision,

      workspaceRevision: input.workspaceRevision,

      summary: input.plan.summary,

      changedFiles: input.plan.changedFiles,

      risks: input.plan.risks,

      reproduction: {
        testFiles: input.reproduction.testFiles,

        expectedFailureMarker: input.reproduction.expectedFailureMarker,

        failingExecutionId: input.reproduction.commandResult.executionId
      },

      patchArtifact,

      commandArtifact: input.commandResult.artifact,

      commandResult: {
        executionId: input.commandResult.executionId,

        operation: input.commandResult.operation,

        exitCode: input.commandResult.exitCode,

        signal: input.commandResult.signal,

        timedOut: input.commandResult.timedOut,

        succeeded: input.commandResult.succeeded,

        durationMs: input.commandResult.durationMs
      }
    })

    return {
      implementation: implementationArtifact,

      patch: patchArtifact,

      command: input.commandResult.artifact
    }
  }

  private async writeJsonAtomic(
    filePath: string,
    value: unknown
  ): Promise<void> {
    await this.writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`)
  }

  private async writeAtomic(
    filePath: string,
    content: string
  ): Promise<void> {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`

    await writeFile(temporaryPath, content, 'utf8')

    await rename(temporaryPath, filePath)
  }
}

function assertValidIdentifier(value: string, kind: string): void {
  if (!validIdentifierPattern.test(value)) {
    throw new ImplementerError(
      `Invalid ${kind} identifier: ${value}`,
      ImplementerErrorCode.invalid_input
    )
  }
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}
