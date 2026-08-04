import type {
  RunValidationCheck,
  RunValidationReport,
  TargetRepositoryValidator
} from '~/core/run'

import { access, stat } from 'node:fs/promises'
import path from 'node:path'
import { GitCommandRunner } from '~/infra/git'

export class GitTargetRepositoryValidator implements TargetRepositoryValidator {
  constructor(
    private readonly git = new GitCommandRunner(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async validate(repositoryPath: string): Promise<RunValidationReport> {
    const resolvedPath = path.resolve(repositoryPath)

    const checks: RunValidationCheck[] = []

    const targetStat = await stat(resolvedPath).catch(() => null)

    const exists = targetStat !== null
    const isDirectory = targetStat?.isDirectory() === true

    checks.push({
      id: 'repository.exists',
      passed: exists,
      message: exists
        ? 'Repository path exists'
        : 'Repository path does not exist'
    })

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
        ? 'Repository path is readable'
        : 'Repository path is not readable'
    })

    let gitRepository = false
    let headExists = false

    if (readable) {
      try {
        const result = await this.git.run(
          ['rev-parse', '--is-inside-work-tree'],
          resolvedPath
        )

        gitRepository = result.stdout.trim() === 'true'
      } catch {
        gitRepository = false
      }

      if (gitRepository) {
        try {
          await this.git.run(
            ['rev-parse', '--verify', 'HEAD'],
            resolvedPath
          )

          headExists = true
        } catch {
          headExists = false
        }
      }
    }

    checks.push({
      id: 'repository.git',
      passed: gitRepository,
      message: gitRepository
        ? 'Target belongs to a Git work tree'
        : 'Target does not belong to a Git work tree'
    })

    checks.push({
      id: 'repository.head',
      passed: headExists,
      message: headExists
        ? 'Git repository has a valid HEAD commit'
        : 'Git repository does not have a valid HEAD commit'
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
    await access(targetPath)
    return true
  } catch {
    return false
  }
}
