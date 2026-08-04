import type { FinalDiffAnalysis } from '~/application/reviewer/final-diff-analyzer'
import type {
  DiffEvidenceReference,
  ReviewDecision,
  ReviewInput
} from '~/core/review'

import {
  ReviewFindingCategory,
  ReviewRecommendation,
  ReviewerError,
  ReviewerErrorCode
} from '~/core/review'

export class ReviewResultValidator {
  validate(
    decision: ReviewDecision,
    input: ReviewInput,
    analysis: FinalDiffAnalysis
  ): ReviewDecision {
    const expectedRevision = input.context.context.workspaceRevision

    if (decision.workspaceRevision !== expectedRevision) {
      throw new ReviewerError(
        'Review result belongs to a stale workspace',
        ReviewerErrorCode.stale_workspace,
        {
          retryable: true
        }
      )
    }

    const diffFiles = analysis.files.map((file) => file.path)

    if (!haveSameStrings(diffFiles, input.changedFiles)) {
      throw new ReviewerError(
        'Final diff files do not match review changed files',
        ReviewerErrorCode.changed_files_mismatch
      )
    }

    const allEvidence = collectReviewEvidence(decision)

    for (const evidence of allEvidence) {
      this.assertGroundedEvidence(evidence, analysis)
    }

    if (
      !input.validationReport.passed &&
      decision.recommendation === ReviewRecommendation.approve
    ) {
      throw new ReviewerError(
        'Reviewer approved changes with failed mechanical validation',
        ReviewerErrorCode.invalid_recommendation,
        {
          retryable: true
        }
      )
    }

    this.assertMandatorySignalsReviewed(decision, analysis)

    if (
      analysis.excessive &&
      !decision.findings.some(
        (finding) =>
          finding.category === ReviewFindingCategory.excessive_change
      )
    ) {
      throw new ReviewerError(
        'Reviewer did not report an excessive final diff',
        ReviewerErrorCode.missed_excessive_change,
        {
          retryable: true
        }
      )
    }

    return decision
  }

  private assertGroundedEvidence(
    evidence: DiffEvidenceReference,
    analysis: FinalDiffAnalysis
  ): void {
    const file = analysis.files.find(
      (candidate) => candidate.path === evidence.filePath
    )

    if (file === undefined) {
      throw new ReviewerError(
        `Review evidence references missing diff file: ` +
          evidence.filePath,
        ReviewerErrorCode.ungrounded_finding,
        {
          retryable: true
        }
      )
    }

    const matchingLine = file.lines.find(
      (line) =>
        line.hunkHeader === evidence.hunkHeader &&
        line.type === evidence.lineType &&
        line.lineNumber === evidence.lineNumber &&
        line.content === evidence.lineContent
    )

    if (matchingLine === undefined) {
      throw new ReviewerError(
        `Review evidence does not exist in final diff: ` +
          `${evidence.filePath}:${evidence.lineNumber}`,
        ReviewerErrorCode.ungrounded_finding,
        {
          retryable: true
        }
      )
    }
  }

  private assertMandatorySignalsReviewed(
    decision: ReviewDecision,
    analysis: FinalDiffAnalysis
  ): void {
    const reviewedEvidenceKeys = new Set(
      collectReviewEvidence(decision).map(createEvidenceKey)
    )

    for (const signal of analysis.signals) {
      if (!signal.mandatory) {
        continue
      }

      if (!reviewedEvidenceKeys.has(createEvidenceKey(signal.evidence))) {
        throw new ReviewerError(
          `Reviewer ignored suspicious diff signal: ${signal.kind}`,
          ReviewerErrorCode.missed_suspicious_change,
          {
            retryable: true
          }
        )
      }
    }
  }
}

function collectReviewEvidence(
  decision: ReviewDecision
): DiffEvidenceReference[] {
  return [
    ...decision.findings.flatMap((finding) => finding.evidence),

    ...decision.risks.flatMap((risk) => risk.evidence),

    ...decision.publicApiChanges.flatMap((change) => change.evidence)
  ]
}

function createEvidenceKey(evidence: DiffEvidenceReference): string {
  return [
    evidence.filePath,
    evidence.hunkHeader,
    evidence.lineType,
    evidence.lineNumber,
    evidence.lineContent
  ].join('\u0000')
}

function haveSameStrings(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length !== right.length) {
    return false
  }

  const leftValues = [...left].sort()
  const rightValues = [...right].sort()

  return leftValues.every((value, index) => value === rightValues[index])
}
