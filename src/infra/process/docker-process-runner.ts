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

const workspaceMountPath = '/workspace'
const defaultTerminationGraceMs = 1000

export interface DockerProcessRunnerFactoryOptions {
  readonly image: string
  readonly commandTimeoutMs: number
  readonly memoryMb: number
  readonly cpus: number
  readonly pidsLimit: number
  readonly resultStore: ProcessResultStore
  readonly terminationGraceMs?: number
  readonly now?: () => Date
  readonly executionIdFactory?: () => string
}

export class DockerProcessRunnerFactory implements ProcessRunnerFactory {
  private readonly image: string
  private readonly commandTimeoutMs: number
  private readonly memoryMb: number
  private readonly cpus: number
  private readonly pidsLimit: number
  private readonly resultStore: ProcessResultStore
  private readonly terminationGraceMs: number
  private readonly now: () => Date
  private readonly executionIdFactory: () => string

  constructor(options: DockerProcessRunnerFactoryOptions) {
    assertNonEmptyString(options.image, 'Docker image')
    assertPositiveInteger(options.commandTimeoutMs, 'Command timeout')
    assertPositiveInteger(options.memoryMb, 'Docker memory limit')
    assertPositiveNumber(options.cpus, 'Docker CPU limit')
    assertPositiveInteger(options.pidsLimit, 'Docker process limit')

    const terminationGraceMs =
      options.terminationGraceMs ?? defaultTerminationGraceMs

    assertPositiveInteger(
      terminationGraceMs,
      'Process termination grace period'
    )

    this.image = options.image
    this.commandTimeoutMs = options.commandTimeoutMs
    this.memoryMb = options.memoryMb
    this.cpus = options.cpus
    this.pidsLimit = options.pidsLimit
    this.resultStore = options.resultStore
    this.terminationGraceMs = terminationGraceMs
    this.now = options.now ?? (() => new Date())
    this.executionIdFactory = options.executionIdFactory ?? randomUUID
  }

  create(workspace: WorkspaceSnapshot): ProcessRunner {
    assertWorkspacePath(workspace)

    const executor = new AllowlistedDockerExecutor({
      workspace,
      image: this.image,
      commandTimeoutMs: this.commandTimeoutMs,
      memoryMb: this.memoryMb,
      cpus: this.cpus,
      pidsLimit: this.pidsLimit,
      resultStore: this.resultStore,
      terminationGraceMs: this.terminationGraceMs,
      now: this.now,
      executionIdFactory: this.executionIdFactory
    })

    return Object.freeze({
      runTests: () => executor.execute(ProcessOperation.run_tests, 'test'),

      runTypecheck: () =>
        executor.execute(ProcessOperation.run_typecheck, 'typecheck'),

      runLint: () => executor.execute(ProcessOperation.run_lint, 'lint'),

      runBuild: () => executor.execute(ProcessOperation.run_build, 'build')
    })
  }
}

interface AllowlistedDockerExecutorOptions {
  readonly workspace: WorkspaceSnapshot
  readonly image: string
  readonly commandTimeoutMs: number
  readonly memoryMb: number
  readonly cpus: number
  readonly pidsLimit: number
  readonly resultStore: ProcessResultStore
  readonly terminationGraceMs: number
  readonly now: () => Date
  readonly executionIdFactory: () => string
}

class AllowlistedDockerExecutor {
  private readonly workspace: WorkspaceSnapshot
  private readonly image: string
  private readonly commandTimeoutMs: number
  private readonly memoryMb: number
  private readonly cpus: number
  private readonly pidsLimit: number
  private readonly resultStore: ProcessResultStore
  private readonly terminationGraceMs: number
  private readonly now: () => Date
  private readonly executionIdFactory: () => string

  constructor(options: AllowlistedDockerExecutorOptions) {
    this.workspace = options.workspace
    this.image = options.image
    this.commandTimeoutMs = options.commandTimeoutMs
    this.memoryMb = options.memoryMb
    this.cpus = options.cpus
    this.pidsLimit = options.pidsLimit
    this.resultStore = options.resultStore
    this.terminationGraceMs = options.terminationGraceMs
    this.now = options.now
    this.executionIdFactory = options.executionIdFactory
  }

  execute(
    operation: ProcessOperation,
    scriptName: string
  ): Promise<ProcessOperationResult> {
    const executable = 'docker'
    const executionId = this.executionIdFactory()
    const containerName = createContainerName(executionId)
    const args = this.createDockerArgs(containerName, scriptName)
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
          env: createDockerCliEnvironment(),
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

        removeContainer(containerName)
        terminateProcess(child, 'SIGTERM')

        forceTerminationTimer = setTimeout(() => {
          removeContainer(containerName)
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

  private createDockerArgs(
    containerName: string,
    scriptName: string
  ): string[] {
    const workspacePath = path.resolve(this.workspace.workspacePath)

    const args = [
      'run',
      '--rm',
      '--name',
      containerName,
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--pids-limit',
      String(this.pidsLimit),
      '--memory',
      `${this.memoryMb}m`,
      '--cpus',
      String(this.cpus),
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=64m',
      '--mount',
      createWorkspaceMount(workspacePath),
      '--workdir',
      workspaceMountPath,
      '--env',
      'CI=true',
      '--env',
      'FORCE_COLOR=0',
      '--env',
      'npm_config_color=false',
      '--env',
      'HOME=/tmp'
    ]

    args.push(...createRuntimeUserArgs())
    args.push(this.image, scriptName)

    return args
  }
}

function createWorkspaceMount(workspacePath: string): string {
  return [
    'type=bind',
    `source=${workspacePath}`,
    `target=${workspaceMountPath}`
  ].join(',')
}

function createRuntimeUserArgs(): string[] {
  if (
    typeof process.getuid !== 'function' ||
    typeof process.getgid !== 'function'
  ) {
    return []
  }

  const uid = process.getuid()
  const gid = process.getgid()

  if (uid === 0) {
    return []
  }

  return ['--user', `${uid}:${gid}`]
}

function createContainerName(executionId: string): string {
  const normalized = executionId
    .toLowerCase()
    .replaceAll(/[^a-z0-9_.-]/g, '-')
    .slice(0, 48)

  return `agent-fix-${normalized}`
}

function removeContainer(containerName: string): void {
  try {
    const cleanup = spawn('docker', ['rm', '--force', containerName], {
      detached: false,
      env: createDockerCliEnvironment(),
      shell: false,
      stdio: 'ignore'
    })

    cleanup.unref()
  } catch {
    return
  }
}

function createDockerCliEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    DOCKER_HOST: process.env.DOCKER_HOST,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR
  }
}

function createSpawnError(
  operation: ProcessOperation,
  cause: unknown
): ProcessRunnerError {
  return new ProcessRunnerError(
    `Failed to start Docker process operation ${operation}`,
    ProcessRunnerErrorCode.spawn_failed,
    {
      operation,
      cause
    }
  )
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
    error instanceof Error && 'code' in error && error.code === 'ESRCH'
  )
}

function assertWorkspacePath(workspace: WorkspaceSnapshot): void {
  if (
    workspace.workspacePath.trim().length === 0 ||
    !path.isAbsolute(workspace.workspacePath)
  ) {
    throw new ProcessRunnerError(
      'Workspace path must be absolute',
      ProcessRunnerErrorCode.invalid_workspace
    )
  }

  if (workspace.runId.trim().length === 0) {
    throw new ProcessRunnerError(
      'Workspace run identifier is required',
      ProcessRunnerErrorCode.invalid_run
    )
  }

  if (workspace.workspaceRevision.trim().length === 0) {
    throw new ProcessRunnerError(
      'Workspace revision is required',
      ProcessRunnerErrorCode.invalid_workspace
    )
  }
}

function assertNonEmptyString(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new ProcessRunnerError(
      `${name} must not be empty`,
      ProcessRunnerErrorCode.invalid_configuration
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

function assertPositiveNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ProcessRunnerError(
      `${name} must be a positive number`,
      ProcessRunnerErrorCode.invalid_configuration
    )
  }
}
