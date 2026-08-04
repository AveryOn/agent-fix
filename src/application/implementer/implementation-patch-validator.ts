import type {
  AllowedFileScope,
  ImplementationPlan,
  ReproductionFailureSnapshot
} from '~/core/implementation'

import {
  ImplementerError,
  ImplementerErrorCode
} from '~/core/implementation'

const diffHeaderPattern = /^diff --git a\/(.+) b\/(.+)$/gm

const forbiddenPatchMarkers = [
  'GIT binary patch',
  'Binary files ',
  'rename from ',
  'rename to ',
  'deleted file mode '
]

export class ImplementationPatchValidator {
  validate(
    plan: ImplementationPlan,
    allowedFileScope: AllowedFileScope,
    reproduction: ReproductionFailureSnapshot,
    expectedWorkspaceRevision: string
  ): readonly string[] {
    if (plan.workspaceRevision !== expectedWorkspaceRevision) {
      throw new ImplementerError(
        'Implementation patch was produced from a stale workspace',
        ImplementerErrorCode.stale_workspace,
        {
          retryable: true
        }
      )
    }

    if (allowedFileScope.workspaceRevision !== expectedWorkspaceRevision) {
      throw new ImplementerError(
        'Allowed file scope belongs to a stale workspace',
        ImplementerErrorCode.stale_workspace
      )
    }

    for (const marker of forbiddenPatchMarkers) {
      if (plan.patch.includes(marker)) {
        throw new ImplementerError(
          `Implementation patch contains forbidden marker: ${marker}`,
          ImplementerErrorCode.invalid_patch,
          {
            retryable: true
          }
        )
      }
    }

    const patchFiles = extractChangedFiles(plan.patch)

    if (patchFiles.length === 0) {
      throw new ImplementerError(
        'Implementation patch does not contain changed files',
        ImplementerErrorCode.invalid_patch,
        {
          retryable: true
        }
      )
    }

    assertSameFiles(patchFiles, plan.changedFiles)

    const allowedFiles = new Set(allowedFileScope.files)

    const reproductionTestFiles = new Set(reproduction.testFiles)

    for (const filePath of patchFiles) {
      if (!isSafeRelativePath(filePath)) {
        throw new ImplementerError(
          `Implementation patch contains unsafe path: ${filePath}`,
          ImplementerErrorCode.invalid_patch
        )
      }

      if (reproductionTestFiles.has(filePath)) {
        throw new ImplementerError(
          `Implementation patch modifies reproduction test: ${filePath}`,
          ImplementerErrorCode.reproduction_test_modified
        )
      }

      if (!allowedFiles.has(filePath)) {
        throw new ImplementerError(
          `Implementation patch changes file outside allowed scope: ` +
            filePath,
          ImplementerErrorCode.forbidden_file_change
        )
      }
    }

    return patchFiles
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
      throw new ImplementerError(
        'Implementation patch contains a rename or invalid diff header',
        ImplementerErrorCode.invalid_patch
      )
    }

    if (!files.includes(targetPath)) {
      files.push(targetPath)
    }
  }

  return files
}

function assertSameFiles(
  patchFiles: readonly string[],
  declaredFiles: readonly string[]
): void {
  const normalizedPatchFiles = [...patchFiles].sort()

  const normalizedDeclaredFiles = [...declaredFiles].sort()

  if (normalizedPatchFiles.length !== normalizedDeclaredFiles.length) {
    throw new ImplementerError(
      'Declared changed files do not match implementation patch',
      ImplementerErrorCode.changed_files_mismatch,
      {
        retryable: true
      }
    )
  }

  for (let index = 0; index < normalizedPatchFiles.length; index += 1) {
    if (normalizedPatchFiles[index] !== normalizedDeclaredFiles[index]) {
      throw new ImplementerError(
        'Declared changed files do not match implementation patch',
        ImplementerErrorCode.changed_files_mismatch,
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
