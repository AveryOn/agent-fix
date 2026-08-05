import type { InvestigationResult } from '~/core/investigation'
import type { RepositoryTools } from '~/core/workspace'

import { z } from 'zod'
import {
  InvestigatorError,
  InvestigatorErrorCode,
  investigationResultSchema
} from '~/core/investigation'

export class InvestigationValidator {
  async validate(
    result: unknown,
    expectedWorkspaceRevision: string,
    repositoryTools: RepositoryTools
  ): Promise<InvestigationResult> {
    const schemaResult = investigationResultSchema.safeParse(result)

    if (!schemaResult.success) {
      throw new InvestigatorError(
        'Investigation result failed schema validation: ' +
          z.prettifyError(schemaResult.error),
        InvestigatorErrorCode.invalid_output,
        {
          retryable: true,
          cause: schemaResult.error
        }
      )
    }

    const investigation = schemaResult.data

    await this.assertFreshWorkspace(
      investigation,
      expectedWorkspaceRevision,
      repositoryTools
    )

    const repositoryFiles = await repositoryTools.listFiles()

    const existingFiles = new Set(repositoryFiles.map((file) => file.path))

    for (const filePath of investigation.relatedFiles) {
      if (!existingFiles.has(filePath)) {
        throw new InvestigatorError(
          `Investigator referenced a missing file: ${filePath}`,
          InvestigatorErrorCode.hallucinated_file,
          {
            retryable: true
          }
        )
      }
    }

    const fileContents = new Map<string, string>()

    for (const evidence of investigation.evidence) {
      if (!existingFiles.has(evidence.filePath)) {
        throw new InvestigatorError(
          `Evidence references a missing file: ` + evidence.filePath,
          InvestigatorErrorCode.hallucinated_file,
          {
            retryable: true
          }
        )
      }

      const content = await this.getFileContent(
        evidence.filePath,
        repositoryTools,
        fileContents
      )

      this.assertLineRange(
        evidence.filePath,
        evidence.lineStart,
        evidence.lineEnd,
        content
      )

      if (evidence.symbol !== null) {
        this.assertSymbolExists(
          evidence.filePath,
          evidence.symbol,
          evidence.lineStart,
          evidence.lineEnd,
          content
        )
      }
    }

    this.assertGroundedHypothesis(investigation)

    return investigation
  }

  private async assertFreshWorkspace(
    result: InvestigationResult,
    expectedWorkspaceRevision: string,
    repositoryTools: RepositoryTools
  ): Promise<void> {
    if (result.workspaceRevision !== expectedWorkspaceRevision) {
      throw new InvestigatorError(
        'Investigation result was produced from a stale workspace',
        InvestigatorErrorCode.stale_workspace,
        {
          retryable: true
        }
      )
    }

    const currentWorkspaceRevision =
      await repositoryTools.getWorkspaceRevision()

    if (currentWorkspaceRevision !== expectedWorkspaceRevision) {
      throw new InvestigatorError(
        'Workspace changed during investigation',
        InvestigatorErrorCode.stale_workspace,
        {
          retryable: true
        }
      )
    }
  }

  private async getFileContent(
    filePath: string,
    repositoryTools: RepositoryTools,
    cache: Map<string, string>
  ): Promise<string> {
    const cachedContent = cache.get(filePath)

    if (cachedContent !== undefined) {
      return cachedContent
    }

    const file = await repositoryTools.readFile(filePath)

    cache.set(filePath, file.content)

    return file.content
  }

  private assertLineRange(
    filePath: string,
    lineStart: number,
    lineEnd: number,
    content: string
  ): void {
    const lineCount = content.split(/\r?\n/).length

    if (
      lineStart > lineCount ||
      lineEnd > lineCount ||
      lineEnd < lineStart
    ) {
      throw new InvestigatorError(
        `Evidence contains an invalid line range for ` +
          `${filePath}: ${lineStart}-${lineEnd}`,
        InvestigatorErrorCode.invalid_line_range,
        {
          retryable: true
        }
      )
    }
  }

  private assertSymbolExists(
    filePath: string,
    symbol: string,
    lineStart: number,
    lineEnd: number,
    content: string
  ): void {
    const selectedContent = content
      .split(/\r?\n/)
      .slice(lineStart - 1, lineEnd)
      .join('\n')

    const symbolPattern = new RegExp(
      `(^|[^a-zA-Z0-9_$])${escapeRegularExpression(symbol)}` +
        `([^a-zA-Z0-9_$]|$)`
    )

    if (!symbolPattern.test(selectedContent)) {
      throw new InvestigatorError(
        `Investigator referenced missing symbol ${symbol} ` +
          `at ${filePath}:${lineStart}-${lineEnd}`,
        InvestigatorErrorCode.hallucinated_symbol,
        {
          retryable: true
        }
      )
    }
  }

  private assertGroundedHypothesis(result: InvestigationResult): void {
    const normalizedHypothesis = result.hypothesis.toLowerCase()

    const confirmedSymbols = result.evidence
      .map((evidence) => evidence.symbol)
      .filter((symbol): symbol is string => symbol !== null)

    if (confirmedSymbols.length === 0) {
      return
    }

    const referencesKnownSymbol = confirmedSymbols.some((symbol) =>
      normalizedHypothesis.includes(symbol.toLowerCase())
    )

    if (!referencesKnownSymbol) {
      throw new InvestigatorError(
        'Bug hypothesis does not reference any confirmed symbol',
        InvestigatorErrorCode.ungrounded_hypothesis,
        {
          retryable: true
        }
      )
    }
  }
}

function escapeRegularExpression(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
