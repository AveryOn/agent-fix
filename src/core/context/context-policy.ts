import { AgentRole, ArtifactType } from '~/core/context/agent-context'

export enum AgentTaskVisibility {
  original = 'original',
  derived = 'derived'
}

export interface AgentVisibilityPolicy {
  readonly allowedArtifactTypes: ReadonlySet<ArtifactType>
  readonly includeEvidence: boolean
  readonly requireConfirmedEvidence: boolean
  readonly allowRepositoryTools: boolean
  readonly taskVisibility: AgentTaskVisibility
  readonly derivedTask?: string
}

const policies: Record<AgentRole, AgentVisibilityPolicy> = {
  [AgentRole.investigator]: {
    allowedArtifactTypes: new Set([ArtifactType.repository_snapshot]),
    includeEvidence: false,
    requireConfirmedEvidence: false,
    allowRepositoryTools: true,
    taskVisibility: AgentTaskVisibility.original
  },

  [AgentRole.reproducer]: {
    allowedArtifactTypes: new Set([
      ArtifactType.investigation_result,
      ArtifactType.investigation_evidence,
      ArtifactType.test_structure
    ]),
    includeEvidence: true,
    requireConfirmedEvidence: true,
    allowRepositoryTools: false,
    taskVisibility: AgentTaskVisibility.original
  },

  [AgentRole.implementer]: {
    allowedArtifactTypes: new Set([
      ArtifactType.investigation_evidence,
      ArtifactType.reproduction_test,
      ArtifactType.allowed_file_scope
    ]),
    includeEvidence: true,
    requireConfirmedEvidence: true,
    allowRepositoryTools: false,
    taskVisibility: AgentTaskVisibility.derived,
    derivedTask:
      'Implement the confirmed reproduction failure within the allowed file scope.'
  },

  [AgentRole.reviewer]: {
    allowedArtifactTypes: new Set([
      ArtifactType.final_diff,
      ArtifactType.validation_report,
      ArtifactType.changed_files
    ]),
    includeEvidence: false,
    requireConfirmedEvidence: false,
    allowRepositoryTools: false,
    taskVisibility: AgentTaskVisibility.derived,
    derivedTask:
      'Review the final diff using the validation report and changed file list.'
  }
}

export function getAgentVisibilityPolicy(
  agent: AgentRole
): AgentVisibilityPolicy {
  return policies[agent]
}
