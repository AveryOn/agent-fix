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

    this.assertValidHunkLineCounts(plan.patch)

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
        [
          'Reproduction patch does not contain the exact expected failure marker',
          `Required marker: ${plan.expectedFailureMarker}`,
          'Add this exact string to the failing assertion message or to the conditional throw that proves the defect',
          'Do not place it only in expectedFailureMarker output field'
        ].join('. '),
        ReproducerErrorCode.invalid_patch,
        {
          retryable: true
        }
      )
    }

    const escapedMarker = escapeRegExp(plan.expectedFailureMarker)

    const unconditionalMarkerThrowPattern = new RegExp(
      `throw\\s+new\\s+Error\\(\\s*['"\`]${escapedMarker}['"\`]\\s*\\)`,
      'u'
    )

    if (unconditionalMarkerThrowPattern.test(addedContent)) {
      throw new ReproducerError(
        [
          'Expected failure marker is emitted by an unconditional throw',
          `Required marker: ${plan.expectedFailureMarker}`,
          'The reproduction must fail because a behavioral assertion detects the bug',
          'Do not throw the marker unconditionally',
          'Use the marker as the Vitest assertion message',
          'Example: expect(payments, marker).toHaveLength(1)'
        ].join('. '),
        ReproducerErrorCode.invalid_patch,
        {
          retryable: true
        }
      )
    }

    const markerInCommentPattern = new RegExp(
      `//[^\\n]*${escapedMarker}`,
      'u'
    )

    if (markerInCommentPattern.test(addedContent)) {
      throw new ReproducerError(
        [
          'Expected failure marker is present only in a comment',
          `Required marker: ${plan.expectedFailureMarker}`,
          'Use the marker as the assertion message',
          'Example: expect(value, marker).toHaveLength(1)'
        ].join('. '),
        ReproducerErrorCode.invalid_patch,
        {
          retryable: true
        }
      )
    }

    const markerAsExpectedValuePattern = new RegExp(
      `\\.to(?:Be|Equal)\\(\\s*['"\`]${escapedMarker}['"\`]\\s*\\)`,
      'u'
    )

    if (markerAsExpectedValuePattern.test(addedContent)) {
      throw new ReproducerError(
        [
          'Expected failure marker is used as an asserted domain value',
          `Required marker: ${plan.expectedFailureMarker}`,
          'Do not compare providerEventId or another value with the marker',
          'Use the marker as the assertion message',
          'Example: expect(payments, marker).toHaveLength(1)'
        ].join('. '),
        ReproducerErrorCode.invalid_patch,
        {
          retryable: true
        }
      )
    }

    return changedFiles
  }

  private assertValidHunkLineCounts(patch: string): void {
    const lines = patch.split(/\r?\n/)

    let currentHunkHeader: string | null = null

    let expectedOldLines: number | null = null
    let expectedNewLines: number | null = null

    let actualOldLines = 0
    let actualNewLines = 0

    const validateCurrentHunk = (): void => {
      if (
        currentHunkHeader === null ||
        expectedOldLines === null ||
        expectedNewLines === null
      ) {
        return
      }

      if (
        actualOldLines !== expectedOldLines ||
        actualNewLines !== expectedNewLines
      ) {
        throw new ReproducerError(
          [
            `Invalid unified diff hunk: ${currentHunkHeader}`,
            `Expected old lines: ${expectedOldLines}`,
            `Actual old lines: ${actualOldLines}`,
            `Expected new lines: ${expectedNewLines}`,
            `Actual new lines: ${actualNewLines}`,
            'Correct the numbers in the @@ hunk header'
          ].join('. '),
          ReproducerErrorCode.invalid_patch,
          {
            retryable: true
          }
        )
      }
    }

    for (const line of lines) {
      const hunkMatch = line.match(
        /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/
      )

      if (hunkMatch !== null) {
        validateCurrentHunk()

        currentHunkHeader = line

        expectedOldLines = Number(hunkMatch[1] ?? '1')

        expectedNewLines = Number(hunkMatch[2] ?? '1')

        actualOldLines = 0
        actualNewLines = 0

        continue
      }

      if (
        currentHunkHeader === null ||
        expectedOldLines === null ||
        expectedNewLines === null
      ) {
        continue
      }

      if (line.startsWith('diff --git ')) {
        validateCurrentHunk()

        currentHunkHeader = null
        expectedOldLines = null
        expectedNewLines = null

        actualOldLines = 0
        actualNewLines = 0

        continue
      }

      if (line.startsWith('+')) {
        actualNewLines += 1
        continue
      }

      if (line.startsWith('-')) {
        actualOldLines += 1
        continue
      }

      if (line.startsWith(' ')) {
        actualOldLines += 1
        actualNewLines += 1
      }
    }

    validateCurrentHunk()
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
