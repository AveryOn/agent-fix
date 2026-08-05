import type {
  AgentContext,
  AgentContextSnapshot,
  ArtifactReference,
  EvidenceReference,
  InvestigationContextSource,
  WorkspaceBoundAgentResult
} from '~/core/context/agent-context'
import type { TokenEstimator } from '~/core/context/context-budget'
import type { AgentVisibilityPolicy } from '~/core/context/context-policy'

import { AgentRole } from '~/core/context/agent-context'
import { ApproximateTokenEstimator } from '~/core/context/context-budget'
import {
  ContextBudgetExceededError,
  StaleAgentResultError,
  StaleWorkspaceContextError
} from '~/core/context/context-errors'
import {
  AgentTaskVisibility,
  getAgentVisibilityPolicy
} from '~/core/context/context-policy'

export interface CreateAgentContextInput {
  readonly runId: string
  readonly agent: AgentRole
  readonly task: string
  readonly workspaceRevision: string
  readonly artifacts: readonly ArtifactReference[]
  readonly evidence: readonly EvidenceReference[]
  readonly constraints: readonly string[]
  readonly investigation?: InvestigationContextSource
}

export interface AgentContextManagerOptions {
  readonly tokenBudget: number
  readonly tokenEstimator?: TokenEstimator
  readonly now?: () => Date
}

export class AgentContextManager {
  private readonly tokenBudget: number
  private readonly tokenEstimator: TokenEstimator
  private readonly now: () => Date

  constructor(options: AgentContextManagerOptions) {
    if (
      !Number.isInteger(options.tokenBudget) ||
      options.tokenBudget <= 0
    ) {
      throw new Error('Context token budget must be a positive integer')
    }

    this.tokenBudget = options.tokenBudget
    this.tokenEstimator =
      options.tokenEstimator ?? new ApproximateTokenEstimator()

    this.now = options.now ?? (() => new Date())
  }

  createSnapshot(input: CreateAgentContextInput): AgentContextSnapshot {
    assertNonEmpty(input.runId, 'runId')
    assertNonEmpty(input.workspaceRevision, 'workspaceRevision')

    const policy = getAgentVisibilityPolicy(input.agent)

    const artifacts = this.selectArtifacts(input, policy)

    const evidence = this.selectEvidence(input, policy)

    this.assertFreshReferences(
      input.workspaceRevision,
      artifacts,
      evidence
    )

    let context = this.buildContext(input, policy, artifacts, evidence)

    let estimatedTokens = this.tokenEstimator.estimate(context)

    if (
      estimatedTokens > this.tokenBudget &&
      input.investigation !== undefined &&
      canSummarizeInvestigation(input.agent)
    ) {
      context = this.buildSummarizedContext(
        input,
        policy,
        artifacts,
        evidence,
        input.investigation
      )

      estimatedTokens = this.tokenEstimator.estimate(context)
    }

    if (estimatedTokens > this.tokenBudget) {
      throw new ContextBudgetExceededError(
        input.agent,
        estimatedTokens,
        this.tokenBudget
      )
    }

    return {
      agent: input.agent,
      createdAt: this.now().toISOString(),
      estimatedTokens,
      context
    }
  }

  assertFreshResult(
    snapshot: AgentContextSnapshot,
    result: WorkspaceBoundAgentResult
  ): void {
    const expectedRevision = snapshot.context.workspaceRevision

    if (result.workspaceRevision !== expectedRevision) {
      throw new StaleAgentResultError(
        expectedRevision,
        result.workspaceRevision
      )
    }
  }

  private selectArtifacts(
    input: CreateAgentContextInput,
    policy: AgentVisibilityPolicy
  ): ArtifactReference[] {
    return input.artifacts.filter((artifact) =>
      policy.allowedArtifactTypes.has(artifact.type)
    )
  }

  private selectEvidence(
    input: CreateAgentContextInput,
    policy: AgentVisibilityPolicy
  ): EvidenceReference[] {
    if (!policy.includeEvidence) {
      return []
    }

    if (!policy.requireConfirmedEvidence) {
      return [...input.evidence]
    }

    return input.evidence.filter((evidence) => evidence.confirmed)
  }

  private assertFreshReferences(
    expectedRevision: string,
    artifacts: readonly ArtifactReference[],
    evidence: readonly EvidenceReference[]
  ): void {
    for (const artifact of artifacts) {
      if (artifact.workspaceRevision !== expectedRevision) {
        throw new StaleWorkspaceContextError(
          artifact.id,
          expectedRevision,
          artifact.workspaceRevision
        )
      }
    }

    for (const reference of evidence) {
      if (reference.workspaceRevision !== expectedRevision) {
        throw new StaleWorkspaceContextError(
          reference.id,
          expectedRevision,
          reference.workspaceRevision
        )
      }
    }
  }

  private buildContext(
    input: CreateAgentContextInput,
    policy: AgentVisibilityPolicy,
    artifacts: readonly ArtifactReference[],
    evidence: readonly EvidenceReference[]
  ): AgentContext {
    return {
      runId: input.runId,
      task: resolveTask(input.task, policy),
      workspaceRevision: input.workspaceRevision,
      artifactIds: uniqueStrings(artifacts.map((artifact) => artifact.id)),
      evidence,
      constraints: uniqueStrings(input.constraints)
    }
  }

  private buildSummarizedContext(
    input: CreateAgentContextInput,
    policy: AgentVisibilityPolicy,
    artifacts: readonly ArtifactReference[],
    evidence: readonly EvidenceReference[],
    investigation: InvestigationContextSource
  ): AgentContext {
    const compactEvidence = evidence
      .slice(0, 20)
      .map(compactEvidenceReference)

    const summary = createInvestigationSummary(
      investigation,
      compactEvidence
    )

    return {
      runId: input.runId,
      task: resolveTask(input.task, policy),
      workspaceRevision: input.workspaceRevision,
      artifactIds: uniqueStrings(artifacts.map((artifact) => artifact.id)),
      evidence: compactEvidence,
      constraints: uniqueStrings(input.constraints),
      summary
    }
  }
}

function resolveTask(
  originalTask: string,
  policy: AgentVisibilityPolicy
): string {
  if (policy.taskVisibility === AgentTaskVisibility.original) {
    return originalTask
  }

  return policy.derivedTask ?? 'Complete the assigned pipeline step.'
}

function canSummarizeInvestigation(agent: AgentRole): boolean {
  return agent === AgentRole.reproducer || agent === AgentRole.implementer
}

function compactEvidenceReference(
  evidence: EvidenceReference
): EvidenceReference {
  return {
    ...evidence,
    claim: limitText(evidence.claim, 160)
  }
}

function createInvestigationSummary(
  investigation: InvestigationContextSource,
  evidence: readonly EvidenceReference[]
): string {
  const parts: string[] = [
    `Hypothesis: ${limitText(investigation.hypothesis, 600)}`
  ]

  const relatedFiles = uniqueStrings(investigation.relatedFiles).slice(
    0,
    20
  )

  if (relatedFiles.length > 0) {
    parts.push(`Related files: ${relatedFiles.join(', ')}`)
  }

  if (evidence.length > 0) {
    const locations = evidence.map(formatEvidenceLocation)

    parts.push(`Confirmed evidence: ${locations.join('; ')}`)
  }

  return parts.join('\n')
}

function formatEvidenceLocation(evidence: EvidenceReference): string {
  const lineRange =
    evidence.lineStart === undefined
      ? ''
      : evidence.lineEnd === undefined
        ? `:${evidence.lineStart}`
        : `:${evidence.lineStart}-${evidence.lineEnd}`

  const symbol = evidence.symbol == null ? '' : `#${evidence.symbol}`

  return `${evidence.filePath}${lineRange}${symbol}`
}

function limitText(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) {
    return value
  }

  return `${value.slice(0, maximumLength - 1)}…`
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function assertNonEmpty(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty`)
  }
}
