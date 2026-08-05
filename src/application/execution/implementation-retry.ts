import type { ReproductionResult } from '~/core/reproduction'
import type {
  RepositoryToolsFactory,
  WorkspaceManager,
  WorkspaceSnapshot
} from '~/core/workspace'

import {
  ExecutionError,
  ExecutionErrorCode,
  ExecutionFailureKind
} from '~/core/execution'

export class ImplementationRetryRecovery {
  constructor(
    private readonly workspaceManager: WorkspaceManager,
    private readonly repositoryToolsFactory: RepositoryToolsFactory
  ) {}

  async restoreReproductionWorkspace(
    workspace: WorkspaceSnapshot,
    reproduction: ReproductionResult
  ): Promise<WorkspaceSnapshot> {
    let rolledBackWorkspace: WorkspaceSnapshot

    try {
      rolledBackWorkspace = await this.workspaceManager.rollback(workspace)
    } catch (error) {
      throw new ExecutionError(
        'Failed to rollback implementation attempt',
        ExecutionErrorCode.rollback_failed,
        {
          kind: ExecutionFailureKind.fatal,
          cause: error
        }
      )
    }

    const repositoryTools = this.repositoryToolsFactory.create(
      rolledBackWorkspace
    )

    try {
      const result = await repositoryTools.applyPatch(reproduction.patch)

      if (result.workspaceRevision !== reproduction.workspaceRevision) {
        throw new ExecutionError(
          'Reapplied reproduction patch produced another workspace revision',
          ExecutionErrorCode.stale_checkpoint,
          {
            kind: ExecutionFailureKind.fatal
          }
        )
      }

      return {
        ...rolledBackWorkspace,
        workspaceRevision: result.workspaceRevision
      }
    } catch (error) {
      if (error instanceof ExecutionError) {
        throw error
      }

      throw new ExecutionError(
        'Failed to restore reproduction patch after rollback',
        ExecutionErrorCode.rollback_failed,
        {
          kind: ExecutionFailureKind.fatal,
          cause: error
        }
      )
    }
  }
}
