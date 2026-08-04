import type { ReproductionPlan } from '~/core/reproduction'

import {
  ReproducerError,
  ReproducerErrorCode,
  isTestFilePath
} from '~/core/reproduction'

const diffHeaderPattern = /^diff --git a\/(.+) b\/(.+)$/gm

const forbiddenPatchMarkers = [
  'GIT binary patch',
  'Binary files ',
  'rename from ',
  'rename to ',
  'deleted file mode '
]

export class ReproductionPatchValidator {
  validate(
    plan: ReproductionPlan,
    expectedWorkspaceRevision: string
  ): readonly string[] {
    if (plan.workspaceRevision !== expectedWorkspaceRevision) {
      throw new ReproducerError(
        'Reproduction patch was produced from a stale workspace',
        ReproducerErrorCode.stale_workspace,
        {
          retryable: true
        }
      )
    }

    for (const marker of forbiddenPatchMarkers) {
      if (plan.patch.includes(marker)) {
        throw new ReproducerError(
          `Reproduction patch contains forbidden marker: ${marker}`,
          ReproducerErrorCode.invalid_patch,
          {
            retryable: true
          }
        )
      }
    }

    const changedFiles = extractChangedFiles(plan.patch)

    if (changedFiles.length === 0) {
      throw new ReproducerError(
        'Reproduction patch does not contain changed files',
        ReproducerErrorCode.invalid_patch,
        {
          retryable: true
        }
      )
    }

    for (const filePath of changedFiles) {
      if (!isSafeRelativePath(filePath)) {
        throw new ReproducerError(
          `Reproduction patch contains unsafe path: ${filePath}`,
          ReproducerErrorCode.invalid_patch
        )
      }

      if (!isTestFilePath(filePath)) {
        throw new ReproducerError(
          `Reproducer attempted to modify non-test file: ${filePath}`,
          ReproducerErrorCode.forbidden_file_change
        )
      }
    }

    assertOnlyAdditions(plan.patch)

    assertSameFiles(changedFiles, plan.testFiles)

    const addedContent = extractAddedContent(plan.patch)

    if (!addedContent.includes(plan.expectedFailureMarker)) {
      throw new ReproducerError(
        'Reproduction patch does not contain the ' +
          'expected failure marker',
        ReproducerErrorCode.invalid_patch,
        {
          retryable: true
        }
      )
    }

    return changedFiles
  }
}

function extractChangedFiles(patch: string): string[] {
  const files: string[] = []
  let match: RegExpExecArray | null

  diffHeaderPattern.lastIndex = 0

  while ((match = diffHeaderPattern.exec(patch)) !== null) {
    const sourcePath = match[1]
    const targetPath = match[2]

    if (
      sourcePath === undefined ||
      targetPath === undefined ||
      sourcePath !== targetPath
    ) {
      throw new ReproducerError(
        'Reproduction patch contains a rename or invalid diff header',
        ReproducerErrorCode.invalid_patch
      )
    }

    if (!files.includes(targetPath)) {
      files.push(targetPath)
    }
  }

  return files
}

function assertOnlyAdditions(patch: string): void {
  const lines = patch.split(/\r?\n/)

  let additionCount = 0

  for (const line of lines) {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue
    }

    if (line.startsWith('-')) {
      throw new ReproducerError(
        'Reproduction patch may only add test code',
        ReproducerErrorCode.invalid_patch,
        {
          retryable: true
        }
      )
    }

    if (line.startsWith('+')) {
      additionCount += 1
    }
  }

  if (additionCount === 0) {
    throw new ReproducerError(
      'Reproduction patch does not add test code',
      ReproducerErrorCode.invalid_patch,
      {
        retryable: true
      }
    )
  }
}

function extractAddedContent(patch: string): string {
  return patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++ '))
    .map((line) => line.slice(1))
    .join('\n')
}

function assertSameFiles(
  patchFiles: readonly string[],
  declaredFiles: readonly string[]
): void {
  const normalizedPatchFiles = [...patchFiles].sort()

  const normalizedDeclaredFiles = [...declaredFiles].sort()

  if (normalizedPatchFiles.length !== normalizedDeclaredFiles.length) {
    throw new ReproducerError(
      'Declared test files do not match patch files',
      ReproducerErrorCode.invalid_patch,
      {
        retryable: true
      }
    )
  }

  for (let index = 0; index < normalizedPatchFiles.length; index += 1) {
    if (normalizedPatchFiles[index] !== normalizedDeclaredFiles[index]) {
      throw new ReproducerError(
        'Declared test files do not match patch files',
        ReproducerErrorCode.invalid_patch,
        {
          retryable: true
        }
      )
    }
  }
}

function isSafeRelativePath(filePath: string): boolean {
  if (
    filePath.startsWith('/') ||
    filePath.startsWith('\\') ||
    filePath.includes('\\') ||
    /^[a-zA-Z]:/.test(filePath)
  ) {
    return false
  }

  return filePath
    .split('/')
    .every(
      (segment) =>
        segment.length > 0 && segment !== '.' && segment !== '..'
    )
}
