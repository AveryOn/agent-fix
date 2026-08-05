import type { InvestigationResult } from '~/core/investigation'
import type { RepositoryTools } from '~/core/workspace'

import { ValidationError, ValidationErrorCode } from '~/core/validation'

export class EvidenceReferenceValidator {
  async validate(
    investigation: InvestigationResult,
    repositoryTools: RepositoryTools
  ): Promise<void> {
    const files = await repositoryTools.listFiles()

    const existingFiles = new Set(files.map((file) => file.path))

    for (const filePath of investigation.relatedFiles) {
      if (!existingFiles.has(filePath)) {
        throw new ValidationError(
          `Investigation references missing file: ${filePath}`,
          ValidationErrorCode.invalid_reference
        )
      }
    }

    const contentCache = new Map<string, string>()

    for (const evidence of investigation.evidence) {
      if (!evidence.confirmed) {
        throw new ValidationError(
          `Evidence ${evidence.id} is not confirmed`,
          ValidationErrorCode.invalid_reference
        )
      }

      if (evidence.workspaceRevision !== investigation.workspaceRevision) {
        throw new ValidationError(
          `Evidence ${evidence.id} belongs to a stale workspace`,
          ValidationErrorCode.invalid_reference
        )
      }

      if (!existingFiles.has(evidence.filePath)) {
        throw new ValidationError(
          `Evidence ${evidence.id} references missing file: ` +
            evidence.filePath,
          ValidationErrorCode.invalid_reference
        )
      }

      const content = await this.getFileContent(
        evidence.filePath,
        repositoryTools,
        contentCache
      )

      const lines = content.split(/\r?\n/)

      if (
        evidence.lineStart > lines.length ||
        evidence.lineEnd > lines.length
      ) {
        throw new ValidationError(
          `Evidence ${evidence.id} contains an invalid line range`,
          ValidationErrorCode.invalid_reference
        )
      }

      const selectedContent = lines
        .slice(evidence.lineStart - 1, evidence.lineEnd)
        .join('\n')

      if (evidence.symbol != null) {
        const symbolPattern = createSymbolPattern(evidence.symbol)

        if (!symbolPattern.test(selectedContent)) {
          throw new ValidationError(
            `Evidence ${evidence.id} references missing symbol ` +
              `${evidence.symbol}`,
            ValidationErrorCode.invalid_reference
          )
        }
      }
    }
  }

  private async getFileContent(
    filePath: string,
    repositoryTools: RepositoryTools,
    cache: Map<string, string>
  ): Promise<string> {
    const cached = cache.get(filePath)

    if (cached !== undefined) {
      return cached
    }

    const result = await repositoryTools.readFile(filePath)

    cache.set(filePath, result.content)

    return result.content
  }
}

function createSymbolPattern(symbol: string): RegExp {
  const escaped = symbol.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return new RegExp(`(^|[^a-zA-Z0-9_$])${escaped}` + `([^a-zA-Z0-9_$]|$)`)
}
