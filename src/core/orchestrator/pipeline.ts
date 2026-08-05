import type { HumanApprovalDecision } from '~/core/run'

export enum PipelineStep {
  investigator = 'investigator',
  reproducer = 'reproducer',
  implementer = 'implementer',
  validation = 'validation',
  reviewer = 'reviewer',
  human_approval = 'human_approval',
  finalize = 'finalize'
}

export const pipelineSequence: readonly PipelineStep[] = [
  PipelineStep.investigator,
  PipelineStep.reproducer,
  PipelineStep.implementer,
  PipelineStep.validation,
  PipelineStep.reviewer,
  PipelineStep.human_approval,
  PipelineStep.finalize
]

export interface PipelineRetrySummary {
  readonly investigator: number
  readonly reproducer: number
  readonly implementer: number
  readonly reviewer: number
}

export interface PipelineTokenUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly estimatedCostUsd: number | null
}

export interface FinalRunArtifact {
  readonly schemaVersion: 1
  readonly runId: string
  readonly task: string
  readonly repositoryPath: string
  readonly workspaceRevision: string
  readonly finalDiff: string
  readonly changedFiles: readonly string[]
  readonly validationPassed: boolean
  readonly reviewRecommendation: string
  readonly approvalDecision: HumanApprovalDecision
  readonly retries: PipelineRetrySummary
  readonly tokenUsage: PipelineTokenUsage
  readonly createdAt: string
}

export interface FinalRunArtifactStore {
  save(artifact: FinalRunArtifact): Promise<void>
}
