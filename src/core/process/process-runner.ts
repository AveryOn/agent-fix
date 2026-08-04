import type { WorkspaceSnapshot } from '~/core/workspace'

export enum ProcessOperation {
  run_tests = 'runTests',
  run_typecheck = 'runTypecheck',
  run_lint = 'runLint',
  run_build = 'runBuild'
}

export interface ProcessCommand {
  readonly executable: string
  readonly args: readonly string[]
}

export interface ProcessCommandResult {
  readonly executionId: string
  readonly runId: string
  readonly workspaceRevision: string
  readonly operation: ProcessOperation
  readonly command: ProcessCommand
  readonly cwd: string
  readonly startedAt: string
  readonly completedAt: string
  readonly durationMs: number
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly signal: string | null
  readonly timedOut: boolean
  readonly succeeded: boolean
}

export interface ProcessResultArtifact {
  readonly id: string
  readonly type: 'command.result'
  readonly relativePath: string
}

export interface ProcessOperationResult extends ProcessCommandResult {
  readonly artifact: ProcessResultArtifact
}

export interface ProcessRunner {
  runTests(): Promise<ProcessOperationResult>

  runTypecheck(): Promise<ProcessOperationResult>

  runLint(): Promise<ProcessOperationResult>

  runBuild(): Promise<ProcessOperationResult>
}

export interface ProcessRunnerFactory {
  create(workspace: WorkspaceSnapshot): ProcessRunner
}

export interface ProcessResultStore {
  save(
    runId: string,
    result: ProcessCommandResult
  ): Promise<ProcessResultArtifact>
}
