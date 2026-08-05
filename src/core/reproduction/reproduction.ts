import type {
  AgentContextSnapshot,
  ArtifactReference
} from '~/core/context'
import type { InvestigationResult } from '~/core/investigation'
import type {
  ProcessOperationResult,
  ProcessResultArtifact
} from '~/core/process'
import type { WorkspaceSnapshot } from '~/core/workspace'

import { z } from 'zod'
import { AgentRole } from '~/core/context'
import { investigationResultSchema } from '~/core/investigation'

const repositoryRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(isRepositoryRelativePath, {
    message: 'Path must be repository-relative'
  })

const testFilePathSchema = repositoryRelativePathSchema.refine(
  isTestFilePath,
  {
    message: 'Path must reference a test file'
  }
)

const expectedFailureMarkerSchema = z
  .string()
  .trim()
  .min(1)
  .max(400)
  .regex(
    /^AGENT_FIX_REPRODUCTION: [^\r\n]+$/,
    'Expected failure marker must start with ' + 'AGENT_FIX_REPRODUCTION:'
  )

export const reproductionPlanSchema = z
  .object({
    summary: z.string().trim().min(1).max(2000),

    patch: z.string().trim().min(1).max(200_000),

    testFiles: z.array(testFilePathSchema).min(1).max(20),

    expectedFailureMarker: expectedFailureMarkerSchema,

    workspaceRevision: z.string().trim().min(1)
  })
  .strict()
  .superRefine((plan, context) => {
    const uniqueFiles = new Set(plan.testFiles)

    if (uniqueFiles.size !== plan.testFiles.length) {
      context.addIssue({
        code: 'custom',
        path: ['testFiles'],
        message: 'testFiles contains duplicate paths'
      })
    }
  })

const reproducerContextSnapshotSchema = z
  .object({
    agent: z.literal(AgentRole.reproducer),

    createdAt: z.string().trim().min(1),

    estimatedTokens: z.number().int().nonnegative(),

    context: z
      .object({
        runId: z.string().trim().min(1),

        task: z.string().trim().min(1),

        workspaceRevision: z.string().trim().min(1),

        artifactIds: z.array(z.string().trim().min(1)),

        evidence: z.array(z.unknown()),

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

export const reproductionInputSchema = z
  .object({
    context: reproducerContextSnapshotSchema,

    investigation: investigationResultSchema,

    workspace: workspaceSnapshotSchema
  })
  .strict()
  .superRefine((input, context) => {
    const contextRevision = input.context.context.workspaceRevision

    if (input.context.context.runId !== input.workspace.runId) {
      context.addIssue({
        code: 'custom',
        path: ['workspace', 'runId'],
        message: 'Context and workspace run identifiers do not match'
      })
    }

    if (contextRevision !== input.workspace.workspaceRevision) {
      context.addIssue({
        code: 'custom',
        path: ['workspace', 'workspaceRevision'],
        message: 'Context and workspace revisions do not match'
      })
    }

    if (contextRevision !== input.investigation.workspaceRevision) {
      context.addIssue({
        code: 'custom',
        path: ['investigation', 'workspaceRevision'],
        message: 'Investigation and context revisions do not match'
      })
    }
  })

export type ReproductionPlan = z.infer<typeof reproductionPlanSchema>

export interface ReproductionInput {
  readonly context: AgentContextSnapshot
  readonly investigation: InvestigationResult
  readonly workspace: WorkspaceSnapshot
}

export interface TestSourceFile {
  readonly path: string
  readonly content: string
  readonly truncated: boolean
}

export interface TestStructureSnapshot {
  readonly framework: string | null
  readonly testScript: string | null
  readonly configFiles: readonly TestSourceFile[]
  readonly testFiles: readonly TestSourceFile[]
  readonly workspaceRevision: string
}

export interface StoredArtifactReference {
  readonly id: string
  readonly type: string
  readonly relativePath: string
}

export interface StoredReproductionArtifact extends ArtifactReference {
  readonly relativePath: string
}

export interface StoredReproductionArtifacts {
  readonly reproduction: StoredReproductionArtifact
  readonly patch: StoredArtifactReference
  readonly command: ProcessResultArtifact
}

export interface SaveReproductionArtifactsInput {
  readonly runId: string
  readonly plan: ReproductionPlan
  readonly sourceWorkspaceRevision: string
  readonly workspaceRevision: string
  readonly commandResult: ProcessOperationResult
}

export interface ReproductionArtifactStore {
  save(
    input: SaveReproductionArtifactsInput
  ): Promise<StoredReproductionArtifacts>
}

export interface ReproductionResult {
  readonly summary: string
  readonly patch: string
  readonly testFiles: string[]
  readonly expectedFailureMarker: string
  readonly sourceWorkspaceRevision: string
  readonly workspaceRevision: string
  readonly commandResult: ProcessOperationResult
  readonly artifacts: StoredReproductionArtifacts
}

export interface ReproducerAgent {
  execute(input: ReproductionInput): Promise<ReproductionResult>
}

export function isTestFilePath(filePath: string): boolean {
  const normalizedPath = filePath.toLowerCase()

  const fileName = normalizedPath.split('/').at(-1) ?? ''

  const hasTestDirectory =
    normalizedPath.startsWith('test/') ||
    normalizedPath.startsWith('tests/') ||
    normalizedPath.includes('/test/') ||
    normalizedPath.includes('/tests/') ||
    normalizedPath.includes('/__tests__/')

  const hasTestFileName =
    fileName.includes('.test.') || fileName.includes('.spec.')

  const hasSupportedExtension = /\.(?:[cm]?[jt]sx?)$/.test(fileName)

  return hasSupportedExtension && (hasTestDirectory || hasTestFileName)
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
