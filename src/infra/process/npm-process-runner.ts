import type { ChildProcess, ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import type {
  ProcessCommandResult,
  ProcessOperationResult,
  ProcessResultStore,
  ProcessRunner,
  ProcessRunnerFactory
} from '~/core/process'
import type { WorkspaceSnapshot } from '~/core/workspace'

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  ProcessOperation,
  ProcessRunnerError,
  ProcessRunnerErrorCode
} from '~/core/process'

const defaultTerminationGraceMs = 1000

export interface NpmProcessRunnerFactoryOptions {
  readonly commandTimeoutMs: number
  readonly resultStore: ProcessResultStore
  readonly terminationGraceMs?: number
  readonly now?: () => Date
  readonly executionIdFactory?: () => string
}

export class NpmProcessRunnerFactory implements ProcessRunnerFactory {
  private readonly commandTimeoutMs: number
  private readonly resultStore: ProcessResultStore
  private readonly terminationGraceMs: number
  private readonly now: () => Date
  private readonly executionIdFactory: () => string

  constructor(options: NpmProcessRunnerFactoryOptions) {
    assertPositiveInteger(options.commandTimeoutMs, 'Command timeout')

    const terminationGraceMs =
      options.terminationGraceMs ?? defaultTerminationGraceMs

    assertPositiveInteger(
      terminationGraceMs,
      'Process termination grace period'
    )

    this.commandTimeoutMs = options.commandTimeoutMs
    this.resultStore = options.resultStore
    this.terminationGraceMs = terminationGraceMs
    this.now = options.now ?? (() => new Date())
    this.executionIdFactory = options.executionIdFactory ?? randomUUID
  }

  create(workspace: WorkspaceSnapshot): ProcessRunner {
    assertWorkspacePath(workspace)

    const executor = new AllowlistedNpmExecutor(
      workspace,
      this.resultStore,
      this.commandTimeoutMs,
      this.terminationGraceMs,
      this.now,
      this.executionIdFactory
    )

    return Object.freeze({
      runTests: () => executor.execute(ProcessOperation.run_tests, 'test'),
      runTypecheck: () =>
        executor.execute(ProcessOperation.run_typecheck, 'typecheck'),
      runLint: () => executor.execute(ProcessOperation.run_lint, 'lint'),
      runBuild: () => executor.execute(ProcessOperation.run_build, 'build')
    })
  }
}

class AllowlistedNpmExecutor {
  constructor(
    private readonly workspace: WorkspaceSnapshot,
    private readonly resultStore: ProcessResultStore,
    private readonly commandTimeoutMs: number,
    private readonly terminationGraceMs: number,
    private readonly now: () => Date,
    private readonly executionIdFactory: () => string
  ) {}

  execute(
    operation: ProcessOperation,
    scriptName: string
  ): Promise<ProcessOperationResult> {
    const executable = resolveNpmExecutable()
    const args = ['run', scriptName]
    const executionId = this.executionIdFactory()
    const startedAt = this.now()

    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let settled = false
      let forceTerminationTimer: NodeJS.Timeout | null = null

      let child: ChildProcessByStdio<null, Readable, Readable>

      try {
        child = spawn(executable, args, {
          cwd: this.workspace.workspacePath,
          detached: process.platform !== 'win32',
          env: createExecutionEnvironment(),
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe']
        })
      } catch (error) {
        reject(createSpawnError(operation, error))
        return
      }

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')

      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
      })

      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })

      const timeout = setTimeout(() => {
        timedOut = true

        terminateProcess(child, 'SIGTERM')

        forceTerminationTimer = setTimeout(() => {
          terminateProcess(child, 'SIGKILL')
        }, this.terminationGraceMs)

        forceTerminationTimer.unref()
      }, this.commandTimeoutMs)

      timeout.unref()

      child.once('error', (error) => {
        if (settled) {
          return
        }

        settled = true

        clearTimeout(timeout)

        if (forceTerminationTimer !== null) {
          clearTimeout(forceTerminationTimer)
        }

        reject(createSpawnError(operation, error))
      })

      child.once('close', (exitCode, signal) => {
        if (settled) {
          return
        }

        settled = true

        clearTimeout(timeout)

        if (forceTerminationTimer !== null) {
          clearTimeout(forceTerminationTimer)
        }

        const completedAt = this.now()

        const result: ProcessCommandResult = {
          executionId,
          runId: this.workspace.runId,
          workspaceRevision: this.workspace.workspaceRevision,
          operation,
          command: {
            executable,
            args
          },
          cwd: this.workspace.workspacePath,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: Math.max(
            0,
            completedAt.getTime() - startedAt.getTime()
          ),
          stdout,
          stderr,
          exitCode,
          signal,
          timedOut,
          succeeded: !timedOut && exitCode === 0
        }

        void this.resultStore
          .save(this.workspace.runId, result)
          .then((artifact) => {
            resolve({
              ...result,
              artifact
            })
          })
          .catch(reject)
      })
    })
  }
}

function createSpawnError(
  operation: ProcessOperation,
  cause: unknown
): ProcessRunnerError {
  return new ProcessRunnerError(
    `Failed to start process operation ${operation}`,
    ProcessRunnerErrorCode.spawn_failed,
    {
      operation,
      cause
    }
  )
}

function createExecutionEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CI: 'true',
    FORCE_COLOR: '0',
    npm_config_color: 'false'
  }
}

function resolveNpmExecutable(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function terminateProcess(
  child: ChildProcess,
  signal: NodeJS.Signals
): void {
  if (child.pid === undefined) {
    return
  }

  try {
    if (process.platform === 'win32') {
      child.kill(signal)
      return
    }

    process.kill(-child.pid, signal)
  } catch (error) {
    if (isMissingProcessError(error)) {
      return
    }

    try {
      child.kill(signal)
    } catch {
      return
    }
  }
}

function isMissingProcessError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ESRCH'
  )
}

function assertWorkspacePath(workspace: WorkspaceSnapshot): void {
  const workspaceRoot = path.resolve(workspace.workspaceRoot)
  const workspacePath = path.resolve(workspace.workspacePath)
  const relativePath = path.relative(workspaceRoot, workspacePath)

  const outsideWorkspace =
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)

  if (outsideWorkspace) {
    throw new ProcessRunnerError(
      'Process workspace path is outside the isolated workspace',
      ProcessRunnerErrorCode.invalid_workspace
    )
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ProcessRunnerError(
      `${name} must be a positive integer`,
      ProcessRunnerErrorCode.invalid_configuration
    )
  }
}
