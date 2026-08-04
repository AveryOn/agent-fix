import type {
  ReproductionArtifactStore,
  SaveReproductionArtifactsInput,
  StoredReproductionArtifacts
} from '~/core/reproduction'

import { randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ArtifactType } from '~/core/context'
import { ReproducerError, ReproducerErrorCode } from '~/core/reproduction'

const validIdentifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export class FileReproductionArtifactStore implements ReproductionArtifactStore {
  private readonly runsRoot: string

  constructor(
    runsRoot: string,
    private readonly now: () => Date = () => new Date()
  ) {
    this.runsRoot = path.resolve(runsRoot)
  }

  async save(
    input: SaveReproductionArtifactsInput
  ): Promise<StoredReproductionArtifacts> {
    assertValidIdentifier(input.runId, 'run')
    assertValidIdentifier(input.commandResult.executionId, 'execution')

    if (input.commandResult.runId !== input.runId) {
      throw new ReproducerError(
        'Command result belongs to another run',
        ReproducerErrorCode.test_execution_failed
      )
    }

    if (
      input.commandResult.workspaceRevision !== input.workspaceRevision
    ) {
      throw new ReproducerError(
        'Command result belongs to a stale workspace',
        ReproducerErrorCode.stale_workspace
      )
    }

    const artifactSuffix = input.commandResult.executionId

    const patchFileName = `reproduction-${artifactSuffix}.diff`

    const resultFileName = `reproduction-${artifactSuffix}.json`

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
      id: `reproduction-patch-${artifactSuffix}`,
      type: 'reproduction.patch',
      relativePath: patchRelativePath
    } as const

    const reproductionArtifact = {
      id: `reproduction-test-${artifactSuffix}`,
      type: ArtifactType.reproduction_test,
      relativePath: resultRelativePath,
      workspaceRevision: input.workspaceRevision
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
      testFiles: input.plan.testFiles,
      expectedFailureMarker: input.plan.expectedFailureMarker,
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
      reproduction: reproductionArtifact,
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
    throw new ReproducerError(
      `Invalid ${kind} identifier: ${value}`,
      ReproducerErrorCode.invalid_input
    )
  }
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}
