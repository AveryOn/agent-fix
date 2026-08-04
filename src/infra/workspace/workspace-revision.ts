import type { WorkspaceSnapshot } from '~/core/workspace'
import type { GitCommandRunner } from '~/infra/git'

import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'

export async function calculateWorkspaceRevision(
  workspace: Omit<WorkspaceSnapshot, 'workspaceRevision'>,
  git: GitCommandRunner
): Promise<string> {
  const pathspec = getPathspec(workspace)

  const diff = await git.run(
    ['diff', '--binary', '--no-ext-diff', 'HEAD', '--', pathspec],
    workspace.workspaceRoot
  )

  const untracked = await git.run(
    ['ls-files', '--others', '--exclude-standard', '-z', '--', pathspec],
    workspace.workspaceRoot
  )

  const hash = createHash('sha256')

  hash.update(workspace.baseCommit)
  hash.update('\0')
  hash.update(diff.stdout)
  hash.update('\0')

  const untrackedPaths = splitNull(untracked.stdout).sort()

  for (const repositoryPath of untrackedPaths) {
    const absolutePath = path.join(workspace.workspaceRoot, repositoryPath)

    const fileStat = await lstat(absolutePath).catch(() => null)

    if (
      fileStat === null ||
      !fileStat.isFile() ||
      fileStat.isSymbolicLink()
    ) {
      continue
    }

    hash.update(repositoryPath)
    hash.update('\0')
    hash.update(await readFile(absolutePath))
    hash.update('\0')
  }

  return `sha256:${hash.digest('hex')}`
}

function getPathspec(
  workspace: Pick<WorkspaceSnapshot, 'repositoryRelativePath'>
): string {
  return workspace.repositoryRelativePath === ''
    ? '.'
    : workspace.repositoryRelativePath
}

function splitNull(value: string): string[] {
  return value.split('\0').filter((item) => item.length > 0)
}
