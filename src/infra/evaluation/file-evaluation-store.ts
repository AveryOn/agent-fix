import type {
  EvaluationComparison,
  EvaluationRunResult,
  EvaluationStore
} from '~/core/evaluation'

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { evaluationRunResultSchema } from '~/core/evaluation'

export interface FileEvaluationStoreOptions {
  readonly rootDirectory: string
}

export class FileEvaluationStore implements EvaluationStore {
  private readonly rootDirectory: string

  constructor(options: FileEvaluationStoreOptions) {
    this.rootDirectory = path.resolve(options.rootDirectory)
  }

  async loadBaseline(): Promise<EvaluationRunResult> {
    const content = await readFile(
      path.join(this.rootDirectory, 'baseline.json'),
      'utf8'
    )

    return evaluationRunResultSchema.parse(JSON.parse(content))
  }

  async saveCurrent(result: EvaluationRunResult): Promise<void> {
    await this.writeJson('current.json', result)
  }

  async saveComparison(comparison: EvaluationComparison): Promise<void> {
    await this.writeJson('comparison.json', comparison)
  }

  private async writeJson(
    fileName: string,
    value: unknown
  ): Promise<void> {
    await mkdir(this.rootDirectory, {
      recursive: true
    })

    const filePath = path.join(this.rootDirectory, fileName)

    const temporaryPath = `${filePath}.tmp`

    await writeFile(
      temporaryPath,
      `${JSON.stringify(value, null, 2)}\n`,
      'utf8'
    )

    await rename(temporaryPath, filePath)
  }
}
