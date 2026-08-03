import type {
  RunValidationCheck,
  RunValidationReport,
  TargetRepositoryValidator
} from '~/core/run'

import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import path from 'node:path'

export class FileSystemTargetRepositoryValidator implements TargetRepositoryValidator {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async validate(repositoryPath: string): Promise<RunValidationReport> {
    const resolvedPath = path.resolve(repositoryPath)
    const checks: RunValidationCheck[] = []

    const repositoryStat = await stat(resolvedPath).catch(() => null)

    checks.push({
      id: 'repository.exists',
      passed: repositoryStat !== null,
      message:
        repositoryStat !== null
          ? 'Repository path exists'
          : 'Repository path does not exist'
    })

    const isDirectory = repositoryStat?.isDirectory() === true

    checks.push({
      id: 'repository.directory',
      passed: isDirectory,
      message: isDirectory
        ? 'Repository path is a directory'
        : 'Repository path is not a directory'
    })

    const readable = isDirectory ? await isReadable(resolvedPath) : false

    checks.push({
      id: 'repository.readable',
      passed: readable,
      message: readable
        ? 'Repository directory is readable'
        : 'Repository directory is not readable'
    })

    const gitMetadataExists = isDirectory
      ? await pathExists(path.join(resolvedPath, '.git'))
      : false

    checks.push({
      id: 'repository.git-metadata',
      passed: gitMetadataExists,
      message: gitMetadataExists
        ? 'Git metadata was found'
        : 'Git metadata was not found'
    })

    return {
      timestamp: this.now().toISOString(),
      repositoryPath: resolvedPath,
      passed: checks.every((check) => check.passed),
      checks
    }
  }
}

async function isReadable(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}
