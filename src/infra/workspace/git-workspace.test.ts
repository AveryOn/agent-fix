import { execFile } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkspaceError, WorkspaceErrorCode } from '~/core/workspace'
import {
  GitRepositoryToolsFactory,
  GitWorkspaceManager
} from '~/infra/workspace'

describe('Git workspace and repository tools', () => {
  it('creates an isolated workspace and supports repository operations', async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), 'agent-fix-workspace-')
    )

    try {
      const repositoryRoot = path.join(temporaryRoot, 'repository')

      const targetPath = path.join(repositoryRoot, 'fixture')

      const runsRoot = path.join(temporaryRoot, 'runs')

      await createRepository(repositoryRoot, targetPath)

      await mkdir(path.join(runsRoot, 'run-001', 'workspace'), {
        recursive: true
      })

      const manager = new GitWorkspaceManager({
        runsRoot
      })

      const workspace = await manager.create({
        runId: 'run-001',
        repositoryPath: targetPath
      })

      expect(workspace.repositoryRoot).toBe(repositoryRoot)

      expect(workspace.repositoryRelativePath).toBe('fixture')

      expect(workspace.baseCommit).toMatch(/^[a-f0-9]{40}$/)

      expect(workspace.workspaceRevision).toMatch(/^sha256:/)

      const tools = new GitRepositoryToolsFactory({
        maximumFileSizeBytes: 100,
        maximumPatchSizeBytes: 10_000
      }).create(workspace)

      const files = await tools.listFiles()

      expect(files.map((file) => file.path)).toContain('src/payment.ts')

      const source = await tools.readFile('src/payment.ts')

      expect(source.content).toContain('return 1')

      const matches = await tools.searchCode({
        query: 'createPayment'
      })

      expect(matches).toMatchObject([
        {
          path: 'src/payment.ts',
          line: 1
        }
      ])

      const initialRevision = await tools.getWorkspaceRevision()

      const patch = [
        'diff --git a/src/payment.ts b/src/payment.ts',
        '--- a/src/payment.ts',
        '+++ b/src/payment.ts',
        '@@ -1,3 +1,3 @@',
        ' export function createPayment(): number {',
        '-  return 1',
        '+  return 2',
        ' }',
        ''
      ].join('\n')

      const result = await tools.applyPatch(patch)

      expect(result.changedFiles).toEqual(['src/payment.ts'])

      expect(result.workspaceRevision).not.toBe(initialRevision)

      expect(await tools.getDiff()).toContain('+  return 2')

      const rolledBack = await manager.rollback(workspace)

      expect(
        await readFile(
          path.join(rolledBack.workspacePath, 'src/payment.ts'),
          'utf8'
        )
      ).toContain('return 1')

      expect(await tools.getChangedFiles()).toEqual([])

      await manager.cleanup(rolledBack)

      await expect(stat(rolledBack.workspaceRoot)).rejects.toThrow()
    } finally {
      await rm(temporaryRoot, {
        recursive: true,
        force: true
      })
    }
  })

  it('rejects traversal, secrets, binary files and oversized files', async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), 'agent-fix-policy-')
    )

    try {
      const repositoryRoot = path.join(temporaryRoot, 'repository')

      const runsRoot = path.join(temporaryRoot, 'runs')

      await mkdir(repositoryRoot, {
        recursive: true
      })

      await runGit(['init'], repositoryRoot)

      await writeFile(
        path.join(repositoryRoot, 'safe.ts'),
        'export const safe = true\n'
      )

      await writeFile(
        path.join(repositoryRoot, '.env'),
        'OPENAI_API_KEY=secret\n'
      )

      await writeFile(
        path.join(repositoryRoot, 'binary.bin'),
        Buffer.from([0, 1, 2, 3])
      )

      await writeFile(
        path.join(repositoryRoot, 'large.txt'),
        'x'.repeat(200)
      )

      await runGit(['add', '-f', '.'], repositoryRoot)

      await commitRepository(repositoryRoot)

      await mkdir(path.join(runsRoot, 'run-002'), {
        recursive: true
      })

      const manager = new GitWorkspaceManager({
        runsRoot
      })

      const workspace = await manager.create({
        runId: 'run-002',
        repositoryPath: repositoryRoot
      })

      const tools = new GitRepositoryToolsFactory({
        maximumFileSizeBytes: 100
      }).create(workspace)

      await expect(tools.readFile('../outside.ts')).rejects.toMatchObject({
        code: WorkspaceErrorCode.invalid_path
      })

      await expect(tools.readFile('.env')).rejects.toMatchObject({
        code: WorkspaceErrorCode.forbidden_path
      })

      await expect(tools.readFile('binary.bin')).rejects.toMatchObject({
        code: WorkspaceErrorCode.binary_file
      })

      await expect(tools.readFile('large.txt')).rejects.toMatchObject({
        code: WorkspaceErrorCode.file_too_large
      })

      await expect(
        tools.applyPatch(
          [
            'diff --git a/../outside.ts b/../outside.ts',
            '--- a/../outside.ts',
            '+++ b/../outside.ts',
            '@@ -0,0 +1 @@',
            '+unsafe',
            ''
          ].join('\n')
        )
      ).rejects.toBeInstanceOf(WorkspaceError)

      await manager.cleanup(workspace)
    } finally {
      await rm(temporaryRoot, {
        recursive: true,
        force: true
      })
    }
  })
})

async function createRepository(
  repositoryRoot: string,
  targetPath: string
): Promise<void> {
  await mkdir(path.join(targetPath, 'src'), {
    recursive: true
  })

  await runGit(['init'], repositoryRoot)

  await writeFile(
    path.join(targetPath, 'src/payment.ts'),
    [
      'export function createPayment(): number {',
      '  return 1',
      '}',
      ''
    ].join('\n')
  )

  await runGit(['add', '.'], repositoryRoot)

  await commitRepository(repositoryRoot)
}

async function commitRepository(repositoryRoot: string): Promise<void> {
  await runGit(
    [
      '-c',
      'user.name=AgentFix Test',
      '-c',
      'user.email=agent-fix@example.test',
      'commit',
      '-m',
      'initial'
    ],
    repositoryRoot
  )
}

function runGit(args: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      {
        cwd
      },
      (error) => {
        if (error !== null) {
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          reject(error)
          return
        }

        resolve()
      }
    )
  })
}
