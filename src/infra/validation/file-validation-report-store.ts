import type {
  MechanicalValidationReport,
  StoredValidationReportArtifact,
  ValidationReportStore
} from '~/core/validation'

import { randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ArtifactType } from '~/core/context'

const validRunIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export class FileValidationReportStore implements ValidationReportStore {
  private readonly runsRoot: string

  constructor(runsRoot: string) {
    this.runsRoot = path.resolve(runsRoot)
  }

  async save(
    report: MechanicalValidationReport
  ): Promise<StoredValidationReportArtifact> {
    if (!validRunIdPattern.test(report.runId)) {
      throw new Error(`Invalid validation run identifier: ${report.runId}`)
    }

    const directory = path.join(this.runsRoot, report.runId, 'validation')

    await mkdir(directory, {
      recursive: true
    })

    const fileName = 'final-validation.json'

    const relativePath = path.posix.join('validation', fileName)

    const filePath = path.join(directory, fileName)

    const temporaryPath = `${filePath}.${randomUUID()}.tmp`

    await writeFile(
      temporaryPath,
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8'
    )

    await rename(temporaryPath, filePath)

    return {
      id: 'final-validation-report',
      type: ArtifactType.validation_report,
      workspaceRevision: report.workspaceRevision,
      relativePath
    }
  }
}
