import type { WorkspaceSnapshot } from '~/core/workspace'

import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ProcessOperation } from '~/core/process'
import {
  DockerProcessRunnerFactory,
  FileProcessResultStore
} from '~/infra/process'

const smokeTestEnabled = process.env.DOCKER_SMOKE_TEST === 'true'

const describeDocker = smokeTestEnabled ? describe : describe.skip

const temporaryDirectories: string[] = []

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true
      })
    )
  )
})

describeDocker('DockerProcessRunner smoke test', () => {
  it('runs all allowlisted validation operations in the sandbox', async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), 'agent-fix-docker-')
    )

    temporaryDirectories.push(temporaryRoot)

    const workspacePath = path.join(temporaryRoot, 'workspace')

    const artifactsRoot = path.join(temporaryRoot, 'artifacts')

    await cp(
      path.resolve('fixtures/billing-duplicate-payment'),
      workspacePath,
      {
        recursive: true,
        filter: (source) =>
          !source.includes('node_modules') &&
          !source.includes('/dist') &&
          !source.includes('/coverage')
      }
    )

    const workspace: WorkspaceSnapshot = {
      runId: 'docker-smoke-run',
      repositoryPath: workspacePath,
      repositoryRoot: workspacePath,
      repositoryRelativePath: '',
      workspaceRoot: workspacePath,
      workspacePath,
      baseCommit: 'docker-smoke-base',
      workspaceRevision: 'docker-smoke-revision'
    }

    const factory = new DockerProcessRunnerFactory({
      image: process.env.DOCKER_IMAGE ?? 'agent-fix-sandbox:local',
      commandTimeoutMs: 120_000,
      memoryMb: 512,
      cpus: 1,
      pidsLimit: 256,
      resultStore: new FileProcessResultStore(artifactsRoot)
    })

    const runner = factory.create(workspace)

    const results = [
      await runner.runTests(),
      await runner.runTypecheck(),
      await runner.runLint(),
      await runner.runBuild()
    ]

    expect(results.map((result) => result.operation)).toEqual([
      ProcessOperation.run_tests,
      ProcessOperation.run_typecheck,
      ProcessOperation.run_lint,
      ProcessOperation.run_build
    ])

    for (const result of results) {
      expect(result.succeeded).toBe(true)
      expect(result.exitCode).toBe(0)
      expect(result.timedOut).toBe(false)
      expect(result.command.executable).toBe('docker')
      expect(result.command.args).toContain('--network')
      expect(result.command.args).toContain('none')
      expect(result.command.args).toContain('--read-only')
      expect(result.command.args).toContain('--pids-limit')
      expect(result.command.args).toContain('--memory')
      expect(result.command.args).toContain('--cpus')
    }
  }, 180_000)
})
