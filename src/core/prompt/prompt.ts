import { AgentRole } from '~/core/context'

export type PromptVersion = `v${number}`

export type PromptVersionIdentifier = `${AgentRole}-${PromptVersion}`

export type PromptVersionSelection = Readonly<
  Record<AgentRole, PromptVersion>
>

export type PromptVersionSnapshot = Readonly<
  Record<AgentRole, PromptVersionIdentifier>
>

export interface AgentPrompt {
  readonly id: PromptVersionIdentifier
  readonly agent: AgentRole
  readonly version: PromptVersion
  readonly content: string
  readonly sourcePath: string
}

export interface PromptRegistry {
  load(agent: AgentRole, version?: PromptVersion): Promise<AgentPrompt>

  loadAll(): Promise<readonly AgentPrompt[]>

  getVersionSnapshot(): Promise<PromptVersionSnapshot>
}

export interface PromptTraceMetadata {
  readonly promptVersion: PromptVersionIdentifier
}

export interface PromptEvaluationMetadata {
  readonly promptVersions: PromptVersionSnapshot
}

export const defaultPromptVersions: PromptVersionSelection = Object.freeze(
  {
    [AgentRole.investigator]: 'v1',
    [AgentRole.reproducer]: 'v3',
    [AgentRole.implementer]: 'v1',
    [AgentRole.reviewer]: 'v1'
  }
)

export function createPromptVersionIdentifier(
  agent: AgentRole,
  version: PromptVersion
): PromptVersionIdentifier {
  return `${agent}-${version}`
}

export function createPromptTraceMetadata(
  prompt: AgentPrompt
): PromptTraceMetadata {
  return {
    promptVersion: prompt.id
  }
}

export function createPromptEvaluationMetadata(
  promptVersions: PromptVersionSnapshot
): PromptEvaluationMetadata {
  return {
    promptVersions
  }
}

export function withPromptVersions<TValue extends object>(
  value: TValue,
  promptVersions: PromptVersionSnapshot
): TValue & PromptEvaluationMetadata {
  return {
    ...value,
    promptVersions
  }
}
