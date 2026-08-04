import type { ImplementationResult } from '~/core/implementation'
import type { InvestigationResult } from '~/core/investigation'
import type { ReproductionResult } from '~/core/reproduction'
import type { RepositoryTools, WorkspaceSnapshot } from '~/core/workspace'

import { ProcessOperation } from '~/core/process'
import { ValidationError, ValidationErrorCode } from '~/core/validation'

const diffHeaderPattern = /^diff --git a\/(.+) b\/(.+)$/gm

export interface PatchApplicationValidationInput {
  readonly runId: string

  readonly investigation: InvestigationResult

  readonly reproduction: ReproductionResult

  readonly implementation: ImplementationResult

  readonly workspace: WorkspaceSnapshot
}

export interface PatchApplicationValidationResult {
  readonly finalDiff: string

  readonly changedFiles: readonly string[]
}

export class PatchApplicationValidator {
  async validate(
    input: PatchApplicationValidationInput,
    repositoryTools: RepositoryTools
  ): Promise<PatchApplicationValidationResult> {
    this.assertRevisionChain(input)

    this.assertCommandResult(
      input.reproduction.commandResult,
      input.runId,
      input.reproduction.workspaceRevision
    )

    this.assertCommandResult(
      input.implementation.commandResult,
      input.runId,
      input.implementation.workspaceRevision
    )

    const currentRevision = await repositoryTools.getWorkspaceRevision()

    if (currentRevision !== input.implementation.workspaceRevision) {
      throw new ValidationError(
        'Current workspace does not match the implementation revision',
        ValidationErrorCode.invalid_patch_application
      )
    }

    const reproductionPatchFiles = extractDiffFiles(
      input.reproduction.patch
    )

    assertSameFiles(
      reproductionPatchFiles,
      input.reproduction.testFiles,
      'Reproduction patch files do not match reproduction output'
    )

    const implementationPatchFiles = extractDiffFiles(
      input.implementation.patch
    )

    assertSameFiles(
      implementationPatchFiles,
      input.implementation.changedFiles,
      'Implementation patch files do not match implementation output'
    )

    assertNoOverlap(
      input.reproduction.testFiles,
      input.implementation.changedFiles
    )

    const expectedChangedFiles = uniqueSorted([
      ...input.reproduction.testFiles,
      ...input.implementation.changedFiles
    ])

    const changedFiles = uniqueSorted(
      await repositoryTools.getChangedFiles()
    )

    assertSameFiles(
      changedFiles,
      expectedChangedFiles,
      'Workspace changed files do not match applied agent patches'
    )

    const finalDiff = await repositoryTools.getDiff()

    if (finalDiff.trim().length === 0) {
      throw new ValidationError(
        'Final workspace diff is empty',
        ValidationErrorCode.invalid_patch_application
      )
    }

    const finalDiffFiles = extractDiffFiles(finalDiff)

    assertSameFiles(
      finalDiffFiles,
      changedFiles,
      'Final diff files do not match workspace changed files'
    )

    return {
      finalDiff,
      changedFiles
    }
  }

  private assertRevisionChain(
    input: PatchApplicationValidationInput
  ): void {
    if (
      input.reproduction.sourceWorkspaceRevision !==
      input.investigation.workspaceRevision
    ) {
      throw new ValidationError(
        'Reproduction patch does not originate from the investigation revision',
        ValidationErrorCode.invalid_patch_application
      )
    }

    if (
      input.implementation.sourceWorkspaceRevision !==
      input.reproduction.workspaceRevision
    ) {
      throw new ValidationError(
        'Implementation patch does not originate from the reproduction revision',
        ValidationErrorCode.invalid_patch_application
      )
    }

    if (
      input.workspace.workspaceRevision !==
      input.implementation.workspaceRevision
    ) {
      throw new ValidationError(
        'Final workspace snapshot does not match the implementation revision',
        ValidationErrorCode.invalid_patch_application
      )
    }
  }

  private assertCommandResult(
    result: ReproductionResult['commandResult'],
    expectedRunId: string,
    expectedRevision: string
  ): void {
    if (result.runId !== expectedRunId) {
      throw new ValidationError(
        'Command result belongs to another run',
        ValidationErrorCode.invalid_patch_application
      )
    }

    if (result.workspaceRevision !== expectedRevision) {
      throw new ValidationError(
        'Command result belongs to another workspace revision',
        ValidationErrorCode.invalid_patch_application
      )
    }

    if (result.operation !== ProcessOperation.run_tests) {
      throw new ValidationError(
        'Agent command result is not a test operation',
        ValidationErrorCode.invalid_patch_application
      )
    }
  }
}

function extractDiffFiles(patch: string): string[] {
  const files: string[] = []

  diffHeaderPattern.lastIndex = 0

  let match: RegExpExecArray | null

  while ((match = diffHeaderPattern.exec(patch)) !== null) {
    const sourcePath = match[1]
    const targetPath = match[2]

    if (
      sourcePath === undefined ||
      targetPath === undefined ||
      sourcePath !== targetPath
    ) {
      throw new ValidationError(
        'Diff contains an invalid file header or rename',
        ValidationErrorCode.invalid_patch_application
      )
    }

    files.push(targetPath)
  }

  if (files.length === 0) {
    throw new ValidationError(
      'Diff does not contain changed files',
      ValidationErrorCode.invalid_patch_application
    )
  }

  return uniqueSorted(files)
}

function assertNoOverlap(
  reproductionFiles: readonly string[],
  implementationFiles: readonly string[]
): void {
  const reproductionSet = new Set(reproductionFiles)

  const overlappingFile = implementationFiles.find((filePath) =>
    reproductionSet.has(filePath)
  )

  if (overlappingFile !== undefined) {
    throw new ValidationError(
      `Implementation modifies reproduction test: ${overlappingFile}`,
      ValidationErrorCode.invalid_patch_application
    )
  }
}

function assertSameFiles(
  actual: readonly string[],
  expected: readonly string[],
  message: string
): void {
  const normalizedActual = uniqueSorted(actual)

  const normalizedExpected = uniqueSorted(expected)

  if (normalizedActual.length !== normalizedExpected.length) {
    throw new ValidationError(
      message,
      ValidationErrorCode.invalid_patch_application
    )
  }

  for (let index = 0; index < normalizedActual.length; index += 1) {
    if (normalizedActual[index] !== normalizedExpected[index]) {
      throw new ValidationError(
        message,
        ValidationErrorCode.invalid_patch_application
      )
    }
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}
