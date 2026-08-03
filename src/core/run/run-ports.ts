import type { HumanApprovalDecision, RunState } from '~/core/run/run-state'
import type { RunValidationReport } from '~/core/run/run-validation'

export interface CreateRunStoreInput {
  readonly state: RunState
}

export interface RunStore {
  getRunDirectory(runId: string): string

  create(input: CreateRunStoreInput): Promise<void>
  saveState(state: RunState): Promise<void>

  saveValidation(runId: string, report: RunValidationReport): Promise<void>
}

export interface TargetRepositoryValidator {
  validate(repositoryPath: string): Promise<RunValidationReport>
}

export interface HumanApprovalRequest {
  readonly runId: string
  readonly repositoryPath: string
  readonly task: string
  readonly validation: RunValidationReport
}

export interface HumanApprovalPrompt {
  requestApproval(
    request: HumanApprovalRequest
  ): Promise<HumanApprovalDecision>
}
