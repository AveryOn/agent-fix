import type { AgentContextSnapshot } from '~/core/context'
import type { PromptVersionIdentifier } from '~/core/prompt'
import type { MechanicalValidationReport } from '~/core/validation'

import { z } from 'zod'
import { AgentRole } from '~/core/context'
import { mechanicalValidationReportSchema } from '~/core/validation'

export const ReviewRecommendation = {
  approve: 'approve',
  request_changes: 'request_changes',
  reject: 'reject'
} as const

export type ReviewRecommendation =
  (typeof ReviewRecommendation)[keyof typeof ReviewRecommendation]

export const ReviewSeverity = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  critical: 'critical'
} as const

export type ReviewSeverity =
  (typeof ReviewSeverity)[keyof typeof ReviewSeverity]

export const ReviewFindingCategory = {
  correctness: 'correctness',
  security: 'security',
  maintainability: 'maintainability',
  test_quality: 'test_quality',
  suspicious_change: 'suspicious_change',
  unrelated_change: 'unrelated_change',
  excessive_change: 'excessive_change',
  validation: 'validation'
} as const

export type ReviewFindingCategory =
  (typeof ReviewFindingCategory)[keyof typeof ReviewFindingCategory]

export const PublicApiChangeKind = {
  added: 'added',
  modified: 'modified',
  removed: 'removed'
} as const

export type PublicApiChangeKind =
  (typeof PublicApiChangeKind)[keyof typeof PublicApiChangeKind]

export const DiffLineType = {
  addition: 'addition',
  deletion: 'deletion',
  context: 'context'
} as const

export type DiffLineType = (typeof DiffLineType)[keyof typeof DiffLineType]

const recommendationSchema = z.enum([
  ReviewRecommendation.approve,
  ReviewRecommendation.request_changes,
  ReviewRecommendation.reject
])

const severitySchema = z.enum([
  ReviewSeverity.low,
  ReviewSeverity.medium,
  ReviewSeverity.high,
  ReviewSeverity.critical
])

const findingCategorySchema = z.enum([
  ReviewFindingCategory.correctness,
  ReviewFindingCategory.security,
  ReviewFindingCategory.maintainability,
  ReviewFindingCategory.test_quality,
  ReviewFindingCategory.suspicious_change,
  ReviewFindingCategory.unrelated_change,
  ReviewFindingCategory.excessive_change,
  ReviewFindingCategory.validation
])

const publicApiChangeKindSchema = z.enum([
  PublicApiChangeKind.added,
  PublicApiChangeKind.modified,
  PublicApiChangeKind.removed
])

const diffLineTypeSchema = z.enum([
  DiffLineType.addition,
  DiffLineType.deletion,
  DiffLineType.context
])

const repositoryRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(isRepositoryRelativePath, {
    message: 'Path must be repository-relative'
  })

export const diffEvidenceReferenceSchema = z
  .object({
    filePath: repositoryRelativePathSchema,

    hunkHeader: z.string().trim().min(1).max(500).startsWith('@@'),

    lineType: diffLineTypeSchema,

    lineNumber: z.number().int().positive(),

    lineContent: z.string().max(4000)
  })
  .strict()

export const reviewFindingSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),

    category: findingCategorySchema,

    severity: severitySchema,

    blocking: z.boolean(),

    title: z.string().trim().min(1).max(300),

    description: z.string().trim().min(1).max(3000),

    evidence: z.array(diffEvidenceReferenceSchema).min(1).max(20)
  })
  .strict()

export const reviewRiskSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),

    severity: severitySchema,

    blocking: z.boolean(),

    description: z.string().trim().min(1).max(3000),

    mitigation: z.string().trim().min(1).max(2000).nullable(),

    evidence: z.array(diffEvidenceReferenceSchema).min(1).max(20)
  })
  .strict()

export const publicApiChangeSchema = z
  .object({
    kind: publicApiChangeKindSchema,

    filePath: repositoryRelativePathSchema,

    symbol: z.string().trim().min(1).max(300).nullable(),

    description: z.string().trim().min(1).max(3000),

    evidence: z.array(diffEvidenceReferenceSchema).min(1).max(20)
  })
  .strict()

export const reviewDecisionSchema = z
  .object({
    recommendation: recommendationSchema,

    summary: z.string().trim().min(1).max(4000),

    findings: z.array(reviewFindingSchema).max(100),

    risks: z.array(reviewRiskSchema).max(100),

    publicApiChanges: z.array(publicApiChangeSchema).max(100),

    workspaceRevision: z.string().trim().min(1)
  })
  .strict()
  .superRefine((decision, context) => {
    const findingIds = new Set(
      decision.findings.map((finding) => finding.id)
    )

    if (findingIds.size !== decision.findings.length) {
      context.addIssue({
        code: 'custom',
        path: ['findings'],
        message: 'Review contains duplicate finding identifiers'
      })
    }

    const riskIds = new Set(decision.risks.map((risk) => risk.id))

    if (riskIds.size !== decision.risks.length) {
      context.addIssue({
        code: 'custom',
        path: ['risks'],
        message: 'Review contains duplicate risk identifiers'
      })
    }

    const hasBlockingIssue =
      decision.findings.some((finding) => finding.blocking) ||
      decision.risks.some((risk) => risk.blocking)

    if (
      decision.recommendation === ReviewRecommendation.approve &&
      hasBlockingIssue
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recommendation'],
        message: 'Review cannot approve changes with blocking issues'
      })
    }
  })

const reviewerContextSnapshotSchema = z
  .object({
    agent: z.literal(AgentRole.reviewer),

    createdAt: z.string().trim().min(1),

    estimatedTokens: z.number().int().nonnegative(),

    context: z
      .object({
        runId: z.string().trim().min(1),

        task: z.string().trim().min(1),

        workspaceRevision: z.string().trim().min(1),

        artifactIds: z.array(z.string().trim().min(1)),

        evidence: z.array(z.unknown()).max(0),

        constraints: z.array(z.string()),

        summary: z.string().optional()
      })
      .strict()
  })
  .strict()

export const reviewInputSchema = z
  .object({
    context: reviewerContextSnapshotSchema,

    finalDiff: z.string().trim().min(1).max(2_000_000),

    changedFiles: z.array(repositoryRelativePathSchema).min(1).max(200),

    validationReport: mechanicalValidationReportSchema
  })
  .strict()
  .superRefine((input, context) => {
    const expectedRevision = input.context.context.workspaceRevision

    if (input.context.context.runId !== input.validationReport.runId) {
      context.addIssue({
        code: 'custom',
        path: ['validationReport', 'runId'],
        message:
          'Review context and validation run identifiers do not match'
      })
    }

    if (expectedRevision !== input.validationReport.workspaceRevision) {
      context.addIssue({
        code: 'custom',
        path: ['validationReport', 'workspaceRevision'],
        message: 'Review context and validation revisions do not match'
      })
    }

    const uniqueChangedFiles = new Set(input.changedFiles)

    if (uniqueChangedFiles.size !== input.changedFiles.length) {
      context.addIssue({
        code: 'custom',
        path: ['changedFiles'],
        message: 'Review input contains duplicate changed files'
      })
    }

    if (
      !haveSameStrings(
        input.changedFiles,
        input.validationReport.changedFiles
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['changedFiles'],
        message: 'Review changed files do not match validation report'
      })
    }
  })

export type DiffEvidenceReference = z.infer<
  typeof diffEvidenceReferenceSchema
>

export type ReviewFinding = z.infer<typeof reviewFindingSchema>

export type ReviewRisk = z.infer<typeof reviewRiskSchema>

export type PublicApiChange = z.infer<typeof publicApiChangeSchema>

export type ReviewDecision = z.infer<typeof reviewDecisionSchema>

export interface ReviewInput {
  readonly context: AgentContextSnapshot
  readonly finalDiff: string
  readonly changedFiles: readonly string[]
  readonly validationReport: MechanicalValidationReport
}

export interface StoredReviewArtifact {
  readonly id: string
  readonly type: 'review.result'
  readonly relativePath: string
}

export interface SaveReviewArtifactInput {
  readonly runId: string
  readonly promptVersion: PromptVersionIdentifier
  readonly decision: ReviewDecision
  readonly finalDiff: string
  readonly validationReport: MechanicalValidationReport
}

export interface ReviewArtifactStore {
  save(input: SaveReviewArtifactInput): Promise<StoredReviewArtifact>
}

export type ReviewResult = ReviewDecision & {
  readonly promptVersion: PromptVersionIdentifier
  readonly artifact: StoredReviewArtifact
}

export interface ReviewerAgent {
  execute(input: ReviewInput): Promise<ReviewResult>
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

function isRepositoryRelativePath(value: string): boolean {
  if (
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.includes('\\') ||
    /^[a-zA-Z]:/.test(value)
  ) {
    return false
  }

  return value
    .split('/')
    .every(
      (segment) =>
        segment.length > 0 && segment !== '.' && segment !== '..'
    )
}
