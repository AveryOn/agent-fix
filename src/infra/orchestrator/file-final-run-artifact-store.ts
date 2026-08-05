import type {
  FinalRunArtifact,
  FinalRunArtifactStore
} from '~/core/orchestrator'

import { randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const validRunIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export class FileFinalRunArtifactStore implements FinalRunArtifactStore {
  private readonly runsRoot: string

  constructor(runsRoot: string) {
    this.runsRoot = path.resolve(runsRoot)
  }

  async save(artifact: FinalRunArtifact): Promise<void> {
    assertValidRunId(artifact.runId)

    const finalDirectory = path.join(
      this.runsRoot,
      artifact.runId,
      'final'
    )

    await mkdir(finalDirectory, {
      recursive: true
    })

    await Promise.all([
      this.writeAtomic(
        path.join(finalDirectory, 'result.json'),
        `${JSON.stringify(artifact, null, 2)}\n`
      ),

      this.writeAtomic(
        path.join(finalDirectory, 'final.diff'),
        ensureFinalNewline(artifact.finalDiff)
      ),

      this.writeAtomic(
        path.join(finalDirectory, 'approval.json'),
        `${JSON.stringify(
          {
            runId: artifact.runId,
            decision: artifact.approvalDecision,
            workspaceRevision: artifact.workspaceRevision,
            createdAt: artifact.createdAt
          },
          null,
          2
        )}\n`
      )
    ])
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

function assertValidRunId(runId: string): void {
  if (!validRunIdPattern.test(runId)) {
    throw new Error(`Invalid run identifier: ${runId}`)
  }
}

function ensureFinalNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}
