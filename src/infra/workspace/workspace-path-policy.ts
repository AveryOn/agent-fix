import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { WorkspaceError, WorkspaceErrorCode } from '~/core/workspace'

const forbiddenDirectoryNames = new Set([
  '.git',
  '.runs',
  '.runs-test',
  'node_modules',
  'coverage'
])

const forbiddenFileExtensions = new Set(['.pem', '.key', '.p12', '.pfx'])

export interface ResolvedWorkspaceFile {
  readonly relativePath: string
  readonly absolutePath: string
}

export class WorkspacePathPolicy {
  private readonly workspaceRoot: string

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot)
  }

  resolvePath(relativePath: string): ResolvedWorkspaceFile {
    const normalized = normalizeRelativePath(relativePath)

    this.assertAllowed(normalized)

    const absolutePath = path.resolve(this.workspaceRoot, normalized)

    if (!isInsideDirectory(this.workspaceRoot, absolutePath)) {
      throw new WorkspaceError(
        `Path escapes workspace: ${relativePath}`,
        WorkspaceErrorCode.invalid_path,
        {
          path: relativePath
        }
      )
    }

    return {
      relativePath: normalized,
      absolutePath
    }
  }

  async resolveExistingFile(
    relativePath: string
  ): Promise<ResolvedWorkspaceFile> {
    const resolved = this.resolvePath(relativePath)

    await this.assertNoSymlinkSegments(resolved.relativePath)

    const fileStat = await lstat(resolved.absolutePath).catch(() => null)

    if (fileStat === null) {
      throw new WorkspaceError(
        `File does not exist: ${relativePath}`,
        WorkspaceErrorCode.file_not_found,
        {
          path: relativePath
        }
      )
    }

    if (fileStat.isSymbolicLink()) {
      throw new WorkspaceError(
        `Symbolic links are not allowed: ${relativePath}`,
        WorkspaceErrorCode.symlink_not_allowed,
        {
          path: relativePath
        }
      )
    }

    if (!fileStat.isFile()) {
      throw new WorkspaceError(
        `Path is not a regular file: ${relativePath}`,
        WorkspaceErrorCode.invalid_path,
        {
          path: relativePath
        }
      )
    }

    const actualPath = await realpath(resolved.absolutePath)

    if (!isInsideDirectory(this.workspaceRoot, actualPath)) {
      throw new WorkspaceError(
        `Resolved path escapes workspace: ${relativePath}`,
        WorkspaceErrorCode.invalid_path,
        {
          path: relativePath
        }
      )
    }

    return resolved
  }

  async assertSafePatchPath(relativePath: string): Promise<string> {
    const resolved = this.resolvePath(relativePath)

    await this.assertNoSymlinkSegments(path.dirname(resolved.relativePath))

    return resolved.relativePath
  }

  isAllowed(relativePath: string): boolean {
    try {
      this.resolvePath(relativePath)
      return true
    } catch {
      return false
    }
  }

  private assertAllowed(relativePath: string): void {
    const segments = relativePath
      .split('/')
      .map((segment) => segment.toLowerCase())

    if (segments.some((segment) => forbiddenDirectoryNames.has(segment))) {
      throw new WorkspaceError(
        `Forbidden workspace path: ${relativePath}`,
        WorkspaceErrorCode.forbidden_path,
        {
          path: relativePath
        }
      )
    }

    const baseName = segments.at(-1) ?? ''

    if (
      baseName === '.env' ||
      (baseName.startsWith('.env.') && baseName !== '.env.example')
    ) {
      throw new WorkspaceError(
        `Environment files are forbidden: ${relativePath}`,
        WorkspaceErrorCode.forbidden_path,
        {
          path: relativePath
        }
      )
    }

    const extension = path.extname(baseName)

    if (forbiddenFileExtensions.has(extension)) {
      throw new WorkspaceError(
        `Secret-bearing file is forbidden: ${relativePath}`,
        WorkspaceErrorCode.forbidden_path,
        {
          path: relativePath
        }
      )
    }
  }

  private async assertNoSymlinkSegments(
    relativePath: string
  ): Promise<void> {
    if (relativePath === '.' || relativePath.length === 0) {
      return
    }

    const segments = relativePath.split('/')
    let currentPath = this.workspaceRoot

    for (const segment of segments) {
      currentPath = path.join(currentPath, segment)

      const currentStat = await lstat(currentPath).catch(() => null)

      if (currentStat === null) {
        return
      }

      if (currentStat.isSymbolicLink()) {
        throw new WorkspaceError(
          `Symbolic link path segment is not allowed: ${relativePath}`,
          WorkspaceErrorCode.symlink_not_allowed,
          {
            path: relativePath
          }
        )
      }
    }
  }
}

function normalizeRelativePath(value: string): string {
  if (value.includes('\0') || path.isAbsolute(value)) {
    throw new WorkspaceError(
      `Invalid workspace path: ${value}`,
      WorkspaceErrorCode.invalid_path,
      {
        path: value
      }
    )
  }

  const normalized = path.posix.normalize(value.replaceAll('\\', '/'))

  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new WorkspaceError(
      `Invalid workspace path: ${value}`,
      WorkspaceErrorCode.invalid_path,
      {
        path: value
      }
    )
  }

  return normalized
}

function isInsideDirectory(root: string, target: string): boolean {
  const relative = path.relative(root, target)

  return (
    relative.length > 0 &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  )
}
