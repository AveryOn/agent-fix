import type {
  CreateWorkspaceInput,
  WorkspaceManager,
  WorkspaceSnapshot
} from '~/core/workspace'

import { access, mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { WorkspaceError, WorkspaceErrorCode } from '~/core/workspace'
import { GitCommandRunner } from '~/infra/git'
import { calculateWorkspaceRevision } from '~/infra/workspace/workspace-revision'

const validRunIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export interface GitWorkspaceManagerOptions {
  readonly runsRoot: string
  readonly git?: GitCommandRunner
}

export class GitWorkspaceManager implements WorkspaceManager {
  private readonly runsRoot: string
  private readonly git: GitCommandRunner

  constructor(options: GitWorkspaceManagerOptions) {
    this.runsRoot = path.resolve(options.runsRoot)

    this.git = options.git ?? new GitCommandRunner()
  }

  async create(input: CreateWorkspaceInput): Promise<WorkspaceSnapshot> {
    assertValidRunId(input.runId)

    const repositoryPath = path.resolve(input.repositoryPath)

    await assertAccessibleDirectory(repositoryPath)

    const repositoryRoot = await this.resolveRepositoryRoot(repositoryPath)

    const repositoryRelativePath = normalizeRepositoryRelativePath(
      repositoryRoot,
      repositoryPath
    )

    const baseCommit = (
      await this.git.run(['rev-parse', '--verify', 'HEAD'], repositoryRoot)
    ).stdout.trim()

    const runDirectory = path.join(this.runsRoot, input.runId)

    const workspaceRoot = path.join(runDirectory, 'workspace')

    await mkdir(runDirectory, {
      recursive: true
    })

    await rm(workspaceRoot, {
      recursive: true,
      force: true
    })

    await this.git.run(['worktree', 'prune'], repositoryRoot)

    try {
      await this.git.run(
        ['worktree', 'add', '--detach', workspaceRoot, baseCommit],
        repositoryRoot
      )
    } catch (error) {
      await rm(workspaceRoot, {
        recursive: true,
        force: true
      })

      throw error
    }

    const workspacePath =
      repositoryRelativePath.length === 0
        ? workspaceRoot
        : path.join(workspaceRoot, repositoryRelativePath)

    const targetStat = await stat(workspacePath).catch(() => null)

    if (targetStat === null || !targetStat.isDirectory()) {
      await this.cleanupWorktree(repositoryRoot, workspaceRoot)

      throw new WorkspaceError(
        'Target repository path does not exist in the base commit',
        WorkspaceErrorCode.invalid_repository,
        {
          path: repositoryPath
        }
      )
    }

    const partialWorkspace = {
      runId: input.runId,
      repositoryPath,
      repositoryRoot,
      repositoryRelativePath,
      workspaceRoot,
      workspacePath,
      baseCommit
    }

    const workspaceRevision = await calculateWorkspaceRevision(
      partialWorkspace,
      this.git
    )

    return {
      ...partialWorkspace,
      workspaceRevision
    }
  }

  async rollback(
    workspace: WorkspaceSnapshot
  ): Promise<WorkspaceSnapshot> {
    await this.git.run(
      ['reset', '--hard', workspace.baseCommit],
      workspace.workspaceRoot
    )

    await this.git.run(['clean', '-fd'], workspace.workspaceRoot)

    const workspaceRevision = await calculateWorkspaceRevision(
      workspace,
      this.git
    )

    return {
      ...workspace,
      workspaceRevision
    }
  }

  async cleanup(workspace: WorkspaceSnapshot): Promise<void> {
    await this.cleanupWorktree(
      workspace.repositoryRoot,
      workspace.workspaceRoot
    )
  }

  private async resolveRepositoryRoot(
    repositoryPath: string
  ): Promise<string> {
    try {
      const inside = (
        await this.git.run(
          ['rev-parse', '--is-inside-work-tree'],
          repositoryPath
        )
      ).stdout.trim()

      if (inside !== 'true') {
        throw new Error('Not inside a Git work tree')
      }

      return (
        await this.git.run(
          ['rev-parse', '--show-toplevel'],
          repositoryPath
        )
      ).stdout.trim()
    } catch (error) {
      throw new WorkspaceError(
        `Target is not an accessible Git repository: ${repositoryPath}`,
        WorkspaceErrorCode.invalid_repository,
        {
          path: repositoryPath,
          cause: error
        }
      )
    }
  }

  private async cleanupWorktree(
    repositoryRoot: string,
    workspaceRoot: string
  ): Promise<void> {
    try {
      await this.git.run(
        ['worktree', 'remove', '--force', workspaceRoot],
        repositoryRoot
      )
    } catch {
      await rm(workspaceRoot, {
        recursive: true,
        force: true
      })
    }

    await this.git.run(['worktree', 'prune'], repositoryRoot)
  }
}

async function assertAccessibleDirectory(
  targetPath: string
): Promise<void> {
  const targetStat = await stat(targetPath).catch(() => null)

  if (targetStat === null || !targetStat.isDirectory()) {
    throw new WorkspaceError(
      `Repository path is not a directory: ${targetPath}`,
      WorkspaceErrorCode.invalid_repository,
      {
        path: targetPath
      }
    )
  }

  try {
    await access(targetPath)
  } catch (error) {
    throw new WorkspaceError(
      `Repository path is not accessible: ${targetPath}`,
      WorkspaceErrorCode.invalid_repository,
      {
        path: targetPath,
        cause: error
      }
    )
  }
}

function normalizeRepositoryRelativePath(
  repositoryRoot: string,
  repositoryPath: string
): string {
  const relativePath = path.relative(repositoryRoot, repositoryPath)

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new WorkspaceError(
      'Target path is outside its Git repository',
      WorkspaceErrorCode.invalid_repository,
      {
        path: repositoryPath
      }
    )
  }

  return relativePath.replaceAll(path.sep, '/')
}

function assertValidRunId(runId: string): void {
  if (!validRunIdPattern.test(runId)) {
    throw new WorkspaceError(
      `Invalid run identifier: ${runId}`,
      WorkspaceErrorCode.invalid_path
    )
  }
}
