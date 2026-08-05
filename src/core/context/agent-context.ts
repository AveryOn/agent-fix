export enum AgentRole {
  investigator = 'investigator',
  reproducer = 'reproducer',
  implementer = 'implementer',
  reviewer = 'reviewer'
}

export enum ArtifactType {
  repository_snapshot = 'repository.snapshot',
  investigation_result = 'investigation.result',
  investigation_evidence = 'investigation.evidence',
  test_structure = 'test.structure',
  reproduction_test = 'reproduction.test',
  allowed_file_scope = 'implementation.allowed-file-scope',
  final_diff = 'review.final-diff',
  validation_report = 'review.validation-report',
  changed_files = 'review.changed-files'
}

export interface ArtifactReference {
  readonly id: string
  readonly type: ArtifactType
  readonly workspaceRevision: string
}

export interface EvidenceReference {
  readonly id: string
  readonly artifactId: string
  readonly filePath: string
  readonly claim: string
  readonly confirmed: boolean
  readonly workspaceRevision: string
  readonly symbol?: string | null
  readonly lineStart?: number
  readonly lineEnd?: number
}

export interface InvestigationContextSource {
  readonly hypothesis: string
  readonly relatedFiles: readonly string[]
}

export interface AgentContext {
  readonly runId: string
  readonly task: string
  readonly workspaceRevision: string
  readonly artifactIds: readonly string[]
  readonly evidence: readonly EvidenceReference[]
  readonly constraints: readonly string[]
  readonly summary?: string
}

export interface AgentContextSnapshot {
  readonly agent: AgentRole
  readonly createdAt: string
  readonly estimatedTokens: number
  readonly context: AgentContext
}

export interface WorkspaceBoundAgentResult {
  readonly workspaceRevision: string
}
