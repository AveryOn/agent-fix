import type {
  ReviewArtifactStore,
  SaveReviewArtifactInput,
  StoredReviewArtifact
} from '~/core/review'

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ReviewerError, ReviewerErrorCode } from '~/core/review'

const validIdentifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export class FileReviewArtifactStore implements ReviewArtifactStore {
  private readonly runsRoot: string

  constructor(
    runsRoot: string,
    private readonly now: () => Date = () => new Date()
  ) {
    this.runsRoot = path.resolve(runsRoot)
  }

  async save(
    input: SaveReviewArtifactInput
  ): Promise<StoredReviewArtifact> {
    assertValidIdentifier(input.runId, 'run')

    if (
      input.decision.workspaceRevision !==
      input.validationReport.workspaceRevision
    ) {
      throw new ReviewerError(
        'Review and validation artifacts use different workspace revisions',
        ReviewerErrorCode.stale_workspace
      )
    }

    const reviewId = randomUUID()

    const fileName = `review-${reviewId}.json`

    const relativePath = path.posix.join('agents', fileName)

    const directory = path.join(this.runsRoot, input.runId, 'agents')

    await mkdir(directory, {
      recursive: true
    })

    const artifact: StoredReviewArtifact = {
      id: `review-${reviewId}`,
      type: 'review.result',
      relativePath
    }

    await this.writeJsonAtomic(path.join(directory, fileName), {
      schemaVersion: 1,

      createdAt: this.now().toISOString(),

      runId: input.runId,

      workspaceRevision: input.decision.workspaceRevision,

      promptVersion: input.promptVersion,

      finalDiffSha256: createSha256(input.finalDiff),

      validation: {
        passed: input.validationReport.passed,

        generatedAt: input.validationReport.generatedAt,

        checks: input.validationReport.checks,

        changedFiles: input.validationReport.changedFiles,

        forbiddenFiles: input.validationReport.forbiddenFiles
      },

      recommendation: input.decision.recommendation,

      summary: input.decision.summary,

      findings: input.decision.findings,

      risks: input.decision.risks,

      publicApiChanges: input.decision.publicApiChanges
    })

    return artifact
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

function createSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function assertValidIdentifier(value: string, kind: string): void {
  if (!validIdentifierPattern.test(value)) {
    throw new ReviewerError(
      `Invalid ${kind} identifier: ${value}`,
      ReviewerErrorCode.invalid_input
    )
  }
}
