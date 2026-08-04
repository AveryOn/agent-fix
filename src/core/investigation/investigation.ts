import type { AgentContextSnapshot } from '~/core/context'
import type { WorkspaceSnapshot } from '~/core/workspace'

import { z } from 'zod'
import { AgentRole } from '~/core/context'

export const investigationEvidenceArtifactId = 'investigation-evidence'

const repositoryRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(isRepositoryRelativePath, {
    message: 'Path must be repository-relative'
  })

const investigationEvidenceReferenceSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),

    artifactId: z.literal(investigationEvidenceArtifactId),

    filePath: repositoryRelativePathSchema,

    claim: z.string().trim().min(1).max(2000),

    confirmed: z.literal(true),

    workspaceRevision: z.string().trim().min(1),

    symbol: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/),

    lineStart: z.number().int().positive(),

    lineEnd: z.number().int().positive()
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.lineEnd < evidence.lineStart) {
      context.addIssue({
        code: 'custom',
        path: ['lineEnd'],
        message: 'lineEnd must be greater than or equal to lineStart'
      })
    }
  })

export const investigationResultSchema = z
  .object({
    hypothesis: z.string().trim().min(1).max(4000),

    evidence: z.array(investigationEvidenceReferenceSchema).min(1).max(50),

    relatedFiles: z.array(repositoryRelativePathSchema).min(1).max(100),

    workspaceRevision: z.string().trim().min(1)
  })
  .strict()
  .superRefine((result, context) => {
    const evidenceIds = new Set<string>()
    const relatedFiles = new Set<string>()

    for (const filePath of result.relatedFiles) {
      if (relatedFiles.has(filePath)) {
        context.addIssue({
          code: 'custom',
          path: ['relatedFiles'],
          message: `Duplicate related file: ${filePath}`
        })
      }

      relatedFiles.add(filePath)
    }

    for (const evidence of result.evidence) {
      if (evidenceIds.has(evidence.id)) {
        context.addIssue({
          code: 'custom',
          path: ['evidence'],
          message: `Duplicate evidence identifier: ${evidence.id}`
        })
      }

      evidenceIds.add(evidence.id)

      if (!relatedFiles.has(evidence.filePath)) {
        context.addIssue({
          code: 'custom',
          path: ['evidence'],
          message:
            `Evidence file ${evidence.filePath} is not included ` +
            'in relatedFiles'
        })
      }
    }
  })

const investigatorContextSnapshotSchema = z
  .object({
    agent: z.literal(AgentRole.investigator),

    createdAt: z.string().min(1),

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

const workspaceSnapshotSchema = z
  .object({
    runId: z.string().trim().min(1),

    repositoryPath: z.string().trim().min(1),

    repositoryRoot: z.string().trim().min(1),

    repositoryRelativePath: z.string(),

    workspaceRoot: z.string().trim().min(1),

    workspacePath: z.string().trim().min(1),

    baseCommit: z.string().trim().min(1),

    workspaceRevision: z.string().trim().min(1)
  })
  .strict()

export const investigationInputSchema = z
  .object({
    context: investigatorContextSnapshotSchema,
    workspace: workspaceSnapshotSchema
  })
  .strict()
  .superRefine((input, context) => {
    if (input.context.context.runId !== input.workspace.runId) {
      context.addIssue({
        code: 'custom',
        path: ['workspace', 'runId'],
        message: 'Context and workspace run identifiers do not match'
      })
    }

    if (
      input.context.context.workspaceRevision !==
      input.workspace.workspaceRevision
    ) {
      context.addIssue({
        code: 'custom',
        path: ['workspace', 'workspaceRevision'],
        message: 'Context and workspace revisions do not match'
      })
    }
  })

export type InvestigationEvidenceReference = z.infer<
  typeof investigationEvidenceReferenceSchema
>

export type InvestigationResult = z.infer<typeof investigationResultSchema>

export interface InvestigationInput {
  readonly context: AgentContextSnapshot
  readonly workspace: WorkspaceSnapshot
}

export interface InvestigatorAgent {
  execute(input: InvestigationInput): Promise<InvestigationResult>
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

  const segments = value.split('/')

  return segments.every(
    (segment) => segment.length > 0 && segment !== '.' && segment !== '..'
  )
}
