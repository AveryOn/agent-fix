import type { WorkspaceSnapshot } from '~/core/workspace'

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ProcessOperation,
  ProcessRunnerError,
  ProcessRunnerErrorCode
} from '~/core/process'
import {
  FileProcessResultStore,
  NpmProcessRunnerFactory
} from '~/infra/process'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true
      })
    )
  )
})

describe('NpmProcessRunner', () => {
  it('runs only the allowlisted project operations', async () => {
    const fixture = await createFixture({
      test: createOutputScript('tests'),
      typecheck: createOutputScript('typecheck'),
      lint: createOutputScript('lint'),
      build: createOutputScript('build')
    })

    const runner = fixture.factory.create(fixture.workspace)

    const results = await Promise.all([
      runner.runTests(),
      runner.runTypecheck(),
      runner.runLint(),
      runner.runBuild()
    ])

    expect(results.map((result) => result.operation)).toEqual([
      ProcessOperation.run_tests,
      ProcessOperation.run_typecheck,
      ProcessOperation.run_lint,
      ProcessOperation.run_build
    ])

    expect(results.map((result) => result.command.args)).toEqual([
      ['run', 'test'],
      ['run', 'typecheck'],
      ['run', 'lint'],
      ['run', 'build']
    ])

    for (const result of results) {
      expect(result.succeeded).toBe(true)
      expect(result.exitCode).toBe(0)
      expect(result.timedOut).toBe(false)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
      expect(result.cwd).toBe(fixture.workspace.workspacePath)
      expect(result.artifact.type).toBe('command.result')
    }
  })

  it('captures output, exit code, and duration', async () => {
    const fixture = await createFixture({
      lint:
        "node -e \"console.log('lint-output'); " +
        "console.error('lint-error'); process.exit(3)\""
    })

    const result = await fixture.factory
      .create(fixture.workspace)
      .runLint()

    expect(result.succeeded).toBe(false)
    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('lint-output')
    expect(result.stderr).toContain('lint-error')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('terminates a command after its timeout', async () => {
    const fixture = await createFixture(
      {
        test: 'node -e "setInterval(() => {}, 1000)"'
      },
      {
        commandTimeoutMs: 100,
        terminationGraceMs: 50
      }
    )

    const result = await fixture.factory
      .create(fixture.workspace)
      .runTests()

    expect(result.succeeded).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBeNull()
    expect(result.signal).toMatch(/^SIG/)
  })

  it('saves every command result inside run artifacts', async () => {
    const fixture = await createFixture({
      build: createOutputScript('artifact')
    })

    const result = await fixture.factory
      .create(fixture.workspace)
      .runBuild()

    const artifactPath = path.join(
      fixture.runsRoot,
      fixture.workspace.runId,
      result.artifact.relativePath
    )

    const artifact = JSON.parse(
      await readFile(artifactPath, 'utf8')
    ) as Record<string, unknown>

    expect(artifact).toMatchObject({
      executionId: result.executionId,
      runId: fixture.workspace.runId,
      workspaceRevision: fixture.workspace.workspaceRevision,
      operation: ProcessOperation.run_build,
      exitCode: 0,
      timedOut: false,
      succeeded: true
    })

    expect(artifact).not.toHaveProperty('artifact')
  })

  it('does not expose arbitrary command execution', async () => {
    const fixture = await createFixture({
      test: createOutputScript('tests')
    })

    const runner = fixture.factory.create(fixture.workspace)

    expect(Object.keys(runner)).toEqual([
      'runTests',
      'runTypecheck',
      'runLint',
      'runBuild'
    ])

    expect(Object.isFrozen(runner)).toBe(true)
    expect('execute' in runner).toBe(false)
    expect('runCommand' in runner).toBe(false)
    expect('exec' in runner).toBe(false)
    expect('shell' in runner).toBe(false)
  })

  it('rejects a path outside the isolated workspace', async () => {
    const fixture = await createFixture({
      test: createOutputScript('tests')
    })

    expect(() =>
      fixture.factory.create({
        ...fixture.workspace,
        workspacePath: path.dirname(fixture.workspace.workspaceRoot)
      })
    ).toThrowError(
      expect.objectContaining({
        code: ProcessRunnerErrorCode.invalid_workspace
      })
    )
  })

  it('rejects a command result from another run', async () => {
    const fixture = await createFixture({
      test: createOutputScript('tests')
    })

    const result = await fixture.factory
      .create(fixture.workspace)
      .runTests()

    const store = new FileProcessResultStore(fixture.runsRoot)

    await expect(
      store.save('run-002', {
        ...result,
        artifact: undefined
      } as never)
    ).rejects.toBeInstanceOf(ProcessRunnerError)
  })
})

interface FixtureOptions {
  readonly commandTimeoutMs?: number
  readonly terminationGraceMs?: number
}

async function createFixture(
  scripts: Record<string, string>,
  options: FixtureOptions = {}
): Promise<{
  readonly runsRoot: string
  readonly workspace: WorkspaceSnapshot
  readonly factory: NpmProcessRunnerFactory
}> {
  const root = await mkdtemp(
    path.join(tmpdir(), 'agent-fix-process-runner-')
  )

  temporaryDirectories.push(root)

  const runsRoot = path.join(root, 'runs')
  const workspaceRoot = path.join(runsRoot, 'run-001', 'workspace')

  const workspacePath = path.join(workspaceRoot, 'target')

  await mkdir(workspacePath, {
    recursive: true
  })

  await writeFile(
    path.join(workspacePath, 'package.json'),
    `${JSON.stringify({
      name: 'process-runner-fixture',
      version: '1.0.0',
      private: true,
      scripts
    })}\n`,
    'utf8'
  )

  const workspace: WorkspaceSnapshot = {
    runId: 'run-001',
    repositoryPath: workspacePath,
    repositoryRoot: workspaceRoot,
    repositoryRelativePath: 'target',
    workspaceRoot,
    workspacePath,
    baseCommit: 'base-commit',
    workspaceRevision: 'revision-001'
  }

  const resultStore = new FileProcessResultStore(runsRoot)

  return {
    runsRoot,
    workspace,
    factory: new NpmProcessRunnerFactory({
      commandTimeoutMs: options.commandTimeoutMs ?? 5000,
      terminationGraceMs: options.terminationGraceMs ?? 100,
      resultStore
    })
  }
}

function createOutputScript(label: string): string {
  return `node -e "console.log('${label}-output')"`
}
