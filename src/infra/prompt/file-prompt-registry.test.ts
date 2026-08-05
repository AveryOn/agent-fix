import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentRole } from '~/core/context'
import {
  PromptRegistryErrorCode,
  createPromptEvaluationMetadata,
  createPromptTraceMetadata,
  withPromptVersions
} from '~/core/prompt'
import { FilePromptRegistry } from '~/infra/prompt'

describe('FilePromptRegistry', () => {
  it('loads the active prompt for every agent', async () => {
    const registry = createRegistry()

    const prompts = await registry.loadAll()

    expect(prompts.map((prompt) => prompt.id)).toEqual([
      'investigator-v1',
      'reproducer-v3',
      'implementer-v1',
      'reviewer-v1'
    ])

    for (const prompt of prompts) {
      expect(prompt.content).toContain('## Tool access')
      expect(prompt.content).toContain('## Output constraints')
      expect(prompt.content).not.toContain('prompt-agent:')
      expect(prompt.content).not.toContain('prompt-version:')
    }
  })

  it('loads prompts with role-specific tool constraints', async () => {
    const registry = createRegistry()

    const investigator = await registry.load(AgentRole.investigator)

    const reproducer = await registry.load(AgentRole.reproducer)

    const implementer = await registry.load(AgentRole.implementer)

    const reviewer = await registry.load(AgentRole.reviewer)

    expect(investigator.content).toContain('`searchCode`')
    expect(investigator.content).toContain('`readFile`')
    expect(investigator.content).toContain(
      'arbitrary shell or process execution'
    )

    expect(reproducer.content).toContain('`runTests`')
    expect(reproducer.content).toContain(
      'A test that already passes is not a valid reproduction.'
    )

    expect(implementer.content).toContain('`runTypecheck`')
    expect(implementer.content).toContain('`runLint`')
    expect(implementer.content).toContain('`runBuild`')

    expect(reviewer.content).toContain('No tools are allowed.')
  })

  it('returns prompt versions for traces and evaluations', async () => {
    const registry = createRegistry()

    const investigator = await registry.load(AgentRole.investigator)

    const versions = await registry.getVersionSnapshot()

    expect(createPromptTraceMetadata(investigator)).toEqual({
      promptVersion: 'investigator-v1'
    })

    expect(createPromptEvaluationMetadata(versions)).toEqual({
      promptVersions: {
        investigator: 'investigator-v1',
        reproducer: 'reproducer-v3',
        implementer: 'implementer-v1',
        reviewer: 'reviewer-v1'
      }
    })

    expect(
      withPromptVersions(
        {
          caseId: 'duplicate-payment',
          passed: true
        },
        versions
      )
    ).toEqual({
      caseId: 'duplicate-payment',
      passed: true,
      promptVersions: versions
    })
  })

  it('rejects an unavailable prompt version', async () => {
    const registry = createRegistry()

    await expect(
      registry.load(AgentRole.investigator, 'v2')
    ).rejects.toMatchObject({
      code: PromptRegistryErrorCode.not_found,
      agent: AgentRole.investigator,
      version: 'v2'
    })
  })

  it('rejects prompt metadata that does not match its path', async () => {
    const promptsRoot = await mkdtemp(
      path.join(tmpdir(), 'agent-fix-prompts-')
    )

    try {
      const promptDirectory = path.join(
        promptsRoot,
        AgentRole.investigator
      )

      await mkdir(promptDirectory, {
        recursive: true
      })

      await writeFile(
        path.join(promptDirectory, 'v1.md'),
        [
          '<!-- prompt-agent: reviewer -->',
          '<!-- prompt-version: reviewer-v1 -->',
          '',
          '# Invalid prompt',
          ''
        ].join('\n'),
        'utf8'
      )

      const registry = new FilePromptRegistry({
        promptsRoot
      })

      await expect(
        registry.load(AgentRole.investigator)
      ).rejects.toMatchObject({
        code: PromptRegistryErrorCode.invalid_metadata
      })
    } finally {
      await rm(promptsRoot, {
        recursive: true,
        force: true
      })
    }
  })
})

function createRegistry(): FilePromptRegistry {
  return new FilePromptRegistry({
    promptsRoot: path.resolve('prompts')
  })
}
