import { execFile } from 'node:child_process'
import { WorkspaceError, WorkspaceErrorCode } from '~/core/workspace'

export interface GitCommandResult {
  readonly stdout: string
  readonly stderr: string
}

export interface GitCommandRunnerOptions {
  readonly timeoutMs?: number
  readonly maxBufferBytes?: number
}

export class GitCommandRunner {
  private readonly timeoutMs: number
  private readonly maxBufferBytes: number

  constructor(options: GitCommandRunnerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000

    this.maxBufferBytes = options.maxBufferBytes ?? 20 * 1024 * 1024
  }

  run(args: readonly string[], cwd: string): Promise<GitCommandResult> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        [...args],
        {
          cwd,
          encoding: 'utf8',
          timeout: this.timeoutMs,
          maxBuffer: this.maxBufferBytes,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0'
          }
        },
        (error, stdout, stderr) => {
          if (error !== null) {
            reject(
              new WorkspaceError(
                formatGitError(args, stderr),
                WorkspaceErrorCode.git_command_failed,
                {
                  cause: error
                }
              )
            )

            return
          }

          resolve({
            stdout,
            stderr
          })
        }
      )
    })
  }
}

function formatGitError(args: readonly string[], stderr: string): string {
  const details = stderr.trim()

  return details.length > 0
    ? `Git command failed: ${details}`
    : `Git command failed: git ${args.join(' ')}`
}
