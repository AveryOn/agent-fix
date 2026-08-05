import type {
  ApplyPatchResult,
  CodeSearchMatch,
  ReadRepositoryFileResult,
  RepositoryFile,
  RepositoryTools,
  RepositoryToolsFactory,
  SearchCodeInput,
  WorkspaceSnapshot
} from '~/core/workspace'

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WorkspaceError, WorkspaceErrorCode } from '~/core/workspace'
import { GitCommandRunner } from '~/infra/git'
import { WorkspacePathPolicy } from '~/infra/workspace/workspace-path-policy'
import { calculateWorkspaceRevision } from '~/infra/workspace/workspace-revision'

export interface GitRepositoryToolsOptions {
  readonly maximumFileSizeBytes?: number
  readonly maximumPatchSizeBytes?: number
  readonly maximumSearchResults?: number
}

export class GitRepositoryToolsFactory implements RepositoryToolsFactory {
  constructor(
    private readonly options: GitRepositoryToolsOptions = {},
    private readonly git = new GitCommandRunner()
  ) {}

  create(workspace: WorkspaceSnapshot): RepositoryTools {
    return new GitRepositoryTools(workspace, this.git, this.options)
  }
}

export class GitRepositoryTools implements RepositoryTools {
  private readonly pathPolicy: WorkspacePathPolicy

  private readonly maximumFileSizeBytes: number

  private readonly maximumPatchSizeBytes: number

  private readonly maximumSearchResults: number

  constructor(
    private readonly workspace: WorkspaceSnapshot,
    private readonly git = new GitCommandRunner(),
    options: GitRepositoryToolsOptions = {}
  ) {
    this.pathPolicy = new WorkspacePathPolicy(workspace.workspacePath)

    this.maximumFileSizeBytes = options.maximumFileSizeBytes ?? 1024 * 1024

    this.maximumPatchSizeBytes =
      options.maximumPatchSizeBytes ?? 2 * 1024 * 1024

    this.maximumSearchResults = options.maximumSearchResults ?? 200
  }

  async listFiles(): Promise<readonly RepositoryFile[]> {
    const repositoryPaths = await this.getRepositoryFilePaths()

    const files: RepositoryFile[] = []

    for (const repositoryPath of repositoryPaths) {
      const relativePath = this.toTargetRelativePath(repositoryPath)

      if (
        relativePath === null ||
        !this.pathPolicy.isAllowed(relativePath)
      ) {
        continue
      }

      const resolved = await this.pathPolicy
        .resolveExistingFile(relativePath)
        .catch(() => null)

      if (resolved === null) {
        continue
      }

      const fileStat = await stat(resolved.absolutePath)

      files.push({
        path: relativePath,
        sizeBytes: fileStat.size
      })
    }

    return files.sort((left, right) => left.path.localeCompare(right.path))
  }

  async readFile(relativePath: string): Promise<ReadRepositoryFileResult> {
    const resolved =
      await this.pathPolicy.resolveExistingFile(relativePath)

    const fileStat = await stat(resolved.absolutePath)

    if (fileStat.size > this.maximumFileSizeBytes) {
      throw new WorkspaceError(
        `File exceeds size limit: ${relativePath}`,
        WorkspaceErrorCode.file_too_large,
        {
          path: relativePath
        }
      )
    }

    const content = await readFile(resolved.absolutePath)

    if (content.includes(0)) {
      throw new WorkspaceError(
        `Binary files are not allowed: ${relativePath}`,
        WorkspaceErrorCode.binary_file,
        {
          path: relativePath
        }
      )
    }

    return {
      path: resolved.relativePath,
      sizeBytes: fileStat.size,
      content: content.toString('utf8')
    }
  }

  async searchCode(
    input: SearchCodeInput
  ): Promise<readonly CodeSearchMatch[]> {
    if (input.query.length === 0) {
      throw new WorkspaceError(
        'Search query must not be empty',
        WorkspaceErrorCode.invalid_path
      )
    }

    const maximumResults = Math.min(
      input.maxResults ?? this.maximumSearchResults,
      this.maximumSearchResults
    )

    const query = input.caseSensitive
      ? input.query
      : input.query.toLowerCase()

    const matches: CodeSearchMatch[] = []
    const files = await this.listFiles()

    for (const file of files) {
      if (matches.length >= maximumResults) {
        break
      }

      let content: string

      try {
        content = (await this.readFile(file.path)).content
      } catch (error) {
        if (
          error instanceof WorkspaceError &&
          (error.code === WorkspaceErrorCode.binary_file ||
            error.code === WorkspaceErrorCode.file_too_large)
        ) {
          continue
        }

        throw error
      }

      const lines = content.split(/\r?\n/)

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? ''

        const haystack = input.caseSensitive ? line : line.toLowerCase()

        const column = haystack.indexOf(query)

        if (column === -1) {
          continue
        }

        matches.push({
          path: file.path,
          line: index + 1,
          column: column + 1,
          preview: line.slice(0, 500)
        })

        if (matches.length >= maximumResults) {
          return matches
        }
      }
    }

    return matches
  }

  async applyPatch(patch: string): Promise<ApplyPatchResult> {
    const patchSize = Buffer.byteLength(patch)

    if (patchSize === 0 || patchSize > this.maximumPatchSizeBytes) {
      throw new WorkspaceError(
        'Patch is empty or exceeds the size limit',
        WorkspaceErrorCode.invalid_patch
      )
    }

    if (
      patch.includes('GIT binary patch') ||
      patch.includes('Binary files ') ||
      patch.includes('new file mode 120000')
    ) {
      throw new WorkspaceError(
        'Binary and symbolic-link patches are forbidden',
        WorkspaceErrorCode.invalid_patch
      )
    }

    const patchPaths = extractPatchPaths(patch)

    if (patchPaths.length === 0) {
      throw new WorkspaceError(
        'Patch does not contain file paths',
        WorkspaceErrorCode.invalid_patch
      )
    }

    for (const patchPath of patchPaths) {
      await this.pathPolicy.assertSafePatchPath(patchPath)
    }

    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), 'agent-fix-patch-')
    )

    const patchFile = path.join(temporaryDirectory, 'change.patch')

    try {
      await writeFile(patchFile, patch, 'utf8')

      const directoryOption =
        this.workspace.repositoryRelativePath.length === 0
          ? []
          : [`--directory=${this.workspace.repositoryRelativePath}`]

      await this.git.run(
        [
          'apply',
          '--check',
          '--whitespace=error-all',
          ...directoryOption,
          patchFile
        ],
        this.workspace.workspaceRoot
      )

      await this.git.run(
        ['apply', '--whitespace=error-all', ...directoryOption, patchFile],
        this.workspace.workspaceRoot
      )
    } catch (error) {
      throw new WorkspaceError(
        'Patch validation or application failed',
        WorkspaceErrorCode.invalid_patch,
        {
          cause: error
        }
      )
    } finally {
      await rm(temporaryDirectory, {
        recursive: true,
        force: true
      })
    }

    return {
      changedFiles: await this.getChangedFiles(),
      workspaceRevision: await this.getWorkspaceRevision()
    }
  }

  async revertPatch(patch: string): Promise<void> {
    const patchSize = Buffer.byteLength(patch)

    if (patchSize === 0 || patchSize > this.maximumPatchSizeBytes) {
      throw new WorkspaceError(
        'Rollback patch is empty or exceeds the size limit',
        WorkspaceErrorCode.invalid_patch
      )
    }

    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), 'agent-fix-rollback-')
    )

    const patchFile = path.join(temporaryDirectory, 'change.patch')

    try {
      await writeFile(patchFile, patch, 'utf8')

      const directoryOption =
        this.workspace.repositoryRelativePath.length === 0
          ? []
          : [`--directory=${this.workspace.repositoryRelativePath}`]

      await this.git.run(
        ['apply', '--check', '--reverse', ...directoryOption, patchFile],
        this.workspace.workspaceRoot
      )

      await this.git.run(
        ['apply', '--reverse', ...directoryOption, patchFile],
        this.workspace.workspaceRoot
      )
    } catch (error) {
      throw new WorkspaceError(
        'Failed to revert applied patch',
        WorkspaceErrorCode.invalid_patch,
        {
          cause: error
        }
      )
    } finally {
      await rm(temporaryDirectory, {
        recursive: true,
        force: true
      })
    }
  }

  async getDiff(): Promise<string> {
    const pathspec = this.getPathspec()

    const untrackedResult = await this.git.run(
      ['ls-files', '--others', '--exclude-standard', '-z', '--', pathspec],
      this.workspace.workspaceRoot
    )

    const untrackedFiles = splitNull(untrackedResult.stdout)

    if (untrackedFiles.length > 0) {
      await this.git.run(
        ['add', '--intent-to-add', '--', ...untrackedFiles],
        this.workspace.workspaceRoot
      )
    }

    try {
      const result = await this.git.run(
        ['diff', '--binary', '--no-ext-diff', 'HEAD', '--', pathspec],
        this.workspace.workspaceRoot
      )

      return result.stdout
    } finally {
      if (untrackedFiles.length > 0) {
        await this.git.run(
          ['reset', '--quiet', '--', ...untrackedFiles],
          this.workspace.workspaceRoot
        )
      }
    }
  }
  async getChangedFiles(): Promise<readonly string[]> {
    const pathspec = this.getPathspec()

    const tracked = await this.git.run(
      ['diff', '--name-only', '-z', 'HEAD', '--', pathspec],
      this.workspace.workspaceRoot
    )

    const untracked = await this.git.run(
      ['ls-files', '--others', '--exclude-standard', '-z', '--', pathspec],
      this.workspace.workspaceRoot
    )

    const changedFiles = [
      ...splitNull(tracked.stdout),
      ...splitNull(untracked.stdout)
    ]
      .map((repositoryPath) => this.toTargetRelativePath(repositoryPath))
      .filter(
        (relativePath): relativePath is string =>
          relativePath !== null && this.pathPolicy.isAllowed(relativePath)
      )

    return [...new Set(changedFiles)].sort()
  }

  getWorkspaceRevision(): Promise<string> {
    return calculateWorkspaceRevision(this.workspace, this.git)
  }

  private async getRepositoryFilePaths(): Promise<string[]> {
    const result = await this.git.run(
      [
        'ls-files',
        '-co',
        '--exclude-standard',
        '-z',
        '--',
        this.getPathspec()
      ],
      this.workspace.workspaceRoot
    )

    return [...new Set(splitNull(result.stdout))]
  }

  private getPathspec(): string {
    return this.workspace.repositoryRelativePath.length === 0
      ? '.'
      : this.workspace.repositoryRelativePath
  }

  private toTargetRelativePath(repositoryPath: string): string | null {
    const normalized = repositoryPath.replaceAll('\\', '/')

    const prefix = this.workspace.repositoryRelativePath

    if (prefix.length === 0) {
      return normalized
    }

    if (normalized === prefix) {
      return null
    }

    const expectedPrefix = `${prefix}/`

    if (!normalized.startsWith(expectedPrefix)) {
      return null
    }

    return normalized.slice(expectedPrefix.length)
  }
}

function extractPatchPaths(patch: string): string[] {
  const paths: string[] = []

  for (const line of patch.split('\n')) {
    if (!line.startsWith('--- ') && !line.startsWith('+++ ')) {
      continue
    }

    const rawPath = line.slice(4).split('\t')[0]?.trim()

    if (rawPath === undefined || rawPath === '/dev/null') {
      continue
    }

    if (rawPath.startsWith('"')) {
      throw new WorkspaceError(
        'Quoted patch paths are not supported',
        WorkspaceErrorCode.invalid_patch
      )
    }

    const relativePath =
      rawPath.startsWith('a/') || rawPath.startsWith('b/')
        ? rawPath.slice(2)
        : rawPath

    paths.push(relativePath)
  }

  return [...new Set(paths)]
}

function splitNull(value: string): string[] {
  return value.split('\0').filter((item) => item.length > 0)
}
