import type { DiffEvidenceReference, DiffLineType } from '~/core/review'

import {
  DiffLineType as DiffLineTypeValue,
  ReviewerError,
  ReviewerErrorCode
} from '~/core/review'

export const ReviewDiffSignalKind = {
  disabled_test: 'disabled_test',
  removed_test: 'removed_test',
  validation_suppression: 'validation_suppression',
  public_api_candidate: 'public_api_candidate',
  dependency_change: 'dependency_change'
} as const

export type ReviewDiffSignalKind =
  (typeof ReviewDiffSignalKind)[keyof typeof ReviewDiffSignalKind]

export interface ParsedDiffLine {
  readonly type: DiffLineType
  readonly lineNumber: number
  readonly content: string
  readonly hunkHeader: string
}

export interface ParsedDiffFile {
  readonly path: string
  readonly addedLines: number
  readonly deletedLines: number
  readonly lines: readonly ParsedDiffLine[]
}

export interface ReviewDiffSignal {
  readonly id: string
  readonly kind: ReviewDiffSignalKind
  readonly message: string
  readonly mandatory: boolean
  readonly evidence: DiffEvidenceReference
}

export interface FinalDiffAnalysis {
  readonly files: readonly ParsedDiffFile[]
  readonly totalAddedLines: number
  readonly totalDeletedLines: number
  readonly excessive: boolean
  readonly signals: readonly ReviewDiffSignal[]
}

interface MutableDiffFile {
  path: string
  addedLines: number
  deletedLines: number
  lines: ParsedDiffLine[]
}

interface DiffPosition {
  oldLine: number
  newLine: number
  hunkHeader: string
}

const diffHeaderPattern = /^diff --git a\/(.+) b\/(.+)$/

const hunkHeaderPattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

const disabledTestPattern =
  /\b(?:it|test|describe)\.skip\s*\(|\b(?:xit|xtest|xdescribe)\s*\(/

const testDeclarationPattern = /\b(?:it|test|describe)\s*\(/

const validationSuppressionPattern =
  /@ts-ignore|@ts-nocheck|eslint-disable|istanbul ignore|c8 ignore/i

const publicApiPattern =
  /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:class|function|const|let|var|interface|type|enum|\{)/

export class FinalDiffAnalyzer {
  analyze(finalDiff: string): FinalDiffAnalysis {
    if (
      finalDiff.includes('GIT binary patch') ||
      finalDiff.includes('Binary files ')
    ) {
      throw new ReviewerError(
        'Reviewer cannot inspect binary diff content',
        ReviewerErrorCode.invalid_diff
      )
    }

    const files: MutableDiffFile[] = []
    const signals: ReviewDiffSignal[] = []

    let currentFile: MutableDiffFile | null = null
    let position: DiffPosition | null = null

    const lines = finalDiff.split(/\r?\n/)

    for (const line of lines) {
      const fileMatch = diffHeaderPattern.exec(line)

      if (fileMatch !== null) {
        const sourcePath = fileMatch[1]
        const targetPath = fileMatch[2]

        if (sourcePath === undefined || targetPath === undefined) {
          throw new ReviewerError(
            'Final diff contains an invalid file header',
            ReviewerErrorCode.invalid_diff
          )
        }

        currentFile = {
          path: targetPath,
          addedLines: 0,
          deletedLines: 0,
          lines: []
        }

        files.push(currentFile)
        position = null

        continue
      }

      if (currentFile === null) {
        continue
      }

      const hunkMatch = hunkHeaderPattern.exec(line)

      if (hunkMatch !== null) {
        const oldLine = Number(hunkMatch[1])
        const newLine = Number(hunkMatch[2])

        position = {
          oldLine,
          newLine,
          hunkHeader: line
        }

        continue
      }

      if (position === null) {
        continue
      }

      if (
        line.startsWith('+++ ') ||
        line.startsWith('--- ') ||
        line.startsWith('\\')
      ) {
        continue
      }

      if (line.startsWith('+')) {
        const parsedLine = createParsedLine(
          DiffLineTypeValue.addition,
          position.newLine,
          line.slice(1),
          position.hunkHeader
        )

        currentFile.lines.push(parsedLine)
        currentFile.addedLines += 1

        signals.push(
          ...detectSignals(currentFile.path, parsedLine, signals.length)
        )

        position = {
          ...position,
          newLine: position.newLine + 1
        }

        continue
      }

      if (line.startsWith('-')) {
        const parsedLine = createParsedLine(
          DiffLineTypeValue.deletion,
          position.oldLine,
          line.slice(1),
          position.hunkHeader
        )

        currentFile.lines.push(parsedLine)
        currentFile.deletedLines += 1

        signals.push(
          ...detectSignals(currentFile.path, parsedLine, signals.length)
        )

        position = {
          ...position,
          oldLine: position.oldLine + 1
        }

        continue
      }

      if (line.startsWith(' ')) {
        const parsedLine = createParsedLine(
          DiffLineTypeValue.context,
          position.newLine,
          line.slice(1),
          position.hunkHeader
        )

        currentFile.lines.push(parsedLine)

        signals.push(
          ...detectSignals(currentFile.path, parsedLine, signals.length)
        )

        position = {
          ...position,
          oldLine: position.oldLine + 1,
          newLine: position.newLine + 1
        }
      }
    }

    if (files.length === 0) {
      throw new ReviewerError(
        'Final diff does not contain changed files',
        ReviewerErrorCode.invalid_diff
      )
    }

    const totalAddedLines = files.reduce(
      (total, file) => total + file.addedLines,
      0
    )

    const totalDeletedLines = files.reduce(
      (total, file) => total + file.deletedLines,
      0
    )

    const normalizedSignals = removeRedundantRemovedTestSignals(signals)

    return {
      files,
      totalAddedLines,
      totalDeletedLines,
      excessive:
        files.length > 10 || totalAddedLines + totalDeletedLines > 300,
      signals: normalizedSignals
    }
  }
}

function createParsedLine(
  type: DiffLineType,
  lineNumber: number,
  content: string,
  hunkHeader: string
): ParsedDiffLine {
  return {
    type,
    lineNumber,
    content,
    hunkHeader
  }
}

function detectSignals(
  filePath: string,
  line: ParsedDiffLine,
  currentSignalCount: number
): ReviewDiffSignal[] {
  const signals: ReviewDiffSignal[] = []

  if (
    line.type === DiffLineTypeValue.addition &&
    disabledTestPattern.test(line.content)
  ) {
    signals.push(
      createSignal(
        currentSignalCount + signals.length,
        ReviewDiffSignalKind.disabled_test,
        'Diff adds a disabled test',
        true,
        filePath,
        line
      )
    )
  }

  if (
    line.type === DiffLineTypeValue.deletion &&
    isTestFile(filePath) &&
    testDeclarationPattern.test(line.content)
  ) {
    signals.push(
      createSignal(
        currentSignalCount + signals.length,
        ReviewDiffSignalKind.removed_test,
        'Diff removes an existing test declaration',
        true,
        filePath,
        line
      )
    )
  }

  if (
    line.type === DiffLineTypeValue.addition &&
    validationSuppressionPattern.test(line.content)
  ) {
    signals.push(
      createSignal(
        currentSignalCount + signals.length,
        ReviewDiffSignalKind.validation_suppression,
        'Diff adds a validation suppression directive',
        true,
        filePath,
        line
      )
    )
  }

  if (publicApiPattern.test(line.content)) {
    signals.push(
      createSignal(
        currentSignalCount + signals.length,
        ReviewDiffSignalKind.public_api_candidate,
        'Diff may change a public export',
        false,
        filePath,
        line
      )
    )
  }

  if (
    line.type === DiffLineTypeValue.addition &&
    isDependencyFile(filePath)
  ) {
    signals.push(
      createSignal(
        currentSignalCount + signals.length,
        ReviewDiffSignalKind.dependency_change,
        'Diff changes dependency metadata',
        false,
        filePath,
        line
      )
    )
  }

  return signals
}

function createSignal(
  index: number,
  kind: ReviewDiffSignalKind,
  message: string,
  mandatory: boolean,
  filePath: string,
  line: ParsedDiffLine
): ReviewDiffSignal {
  return {
    id: `diff-signal-${index + 1}`,
    kind,
    message,
    mandatory,
    evidence: {
      filePath,
      hunkHeader: line.hunkHeader,
      lineType: line.type,
      lineNumber: line.lineNumber,
      lineContent: line.content
    }
  }
}

function isTestFile(filePath: string): boolean {
  const normalizedPath = filePath.toLowerCase()

  return (
    normalizedPath.includes('/tests/') ||
    normalizedPath.startsWith('tests/') ||
    normalizedPath.includes('/__tests__/') ||
    normalizedPath.includes('.test.') ||
    normalizedPath.includes('.spec.')
  )
}

function isDependencyFile(filePath: string): boolean {
  const fileName = filePath.split('/').at(-1) ?? filePath

  return (
    fileName === 'package.json' ||
    fileName === 'package-lock.json' ||
    fileName === 'npm-shrinkwrap.json' ||
    fileName === 'pnpm-lock.yaml' ||
    fileName === 'yarn.lock'
  )
}

function removeRedundantRemovedTestSignals(
  signals: readonly ReviewDiffSignal[]
): ReviewDiffSignal[] {
  return signals.filter((signal) => {
    if (signal.kind !== ReviewDiffSignalKind.removed_test) {
      return true
    }

    const replacedByDisabledTest = signals.some(
      (candidate) =>
        candidate.kind === ReviewDiffSignalKind.disabled_test &&
        candidate.evidence.filePath === signal.evidence.filePath &&
        candidate.evidence.hunkHeader === signal.evidence.hunkHeader &&
        normalizeTestDeclaration(candidate.evidence.lineContent) ===
          normalizeTestDeclaration(signal.evidence.lineContent)
    )

    return !replacedByDisabledTest
  })
}

function normalizeTestDeclaration(value: string): string {
  return value
    .replace(/\b(it|test|describe)\.skip\s*\(/, '$1(')
    .replace(/\bxit\s*\(/, 'it(')
    .replace(/\bxtest\s*\(/, 'test(')
    .replace(/\bxdescribe\s*\(/, 'describe(')
    .trim()
}
