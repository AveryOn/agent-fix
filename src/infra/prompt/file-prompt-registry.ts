import type { AgentRole } from '~/core/context'
import type {
  AgentPrompt,
  PromptRegistry,
  PromptVersion,
  PromptVersionSelection,
  PromptVersionSnapshot
} from '~/core/prompt'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { AgentRole as AgentRoleValue } from '~/core/context'
import {
  PromptRegistryError,
  PromptRegistryErrorCode,
  createPromptVersionIdentifier,
  defaultPromptVersions
} from '~/core/prompt'

const promptVersionPattern = /^v[1-9][0-9]*$/

const promptMetadataPattern =
  /^<!-- prompt-agent: ([a-z]+) -->\r?\n<!-- prompt-version: ([a-z0-9-]+) -->\r?\n/

export interface FilePromptRegistryOptions {
  readonly promptsRoot: string
  readonly activeVersions?: PromptVersionSelection
}

export class FilePromptRegistry implements PromptRegistry {
  private readonly promptsRoot: string
  private readonly activeVersions: PromptVersionSelection
  private readonly cache = new Map<string, Promise<AgentPrompt>>()

  constructor(options: FilePromptRegistryOptions) {
    this.promptsRoot = path.resolve(options.promptsRoot)

    this.activeVersions = options.activeVersions ?? defaultPromptVersions
  }

  load(
    agent: AgentRole,
    version: PromptVersion = this.activeVersions[agent]
  ): Promise<AgentPrompt> {
    assertPromptVersion(version, agent)

    const cacheKey = `${agent}:${version}`
    const cachedPrompt = this.cache.get(cacheKey)

    if (cachedPrompt !== undefined) {
      return cachedPrompt
    }

    const loadingPrompt = this.readPrompt(agent, version).catch(
      (error: unknown) => {
        this.cache.delete(cacheKey)
        throw error
      }
    )

    this.cache.set(cacheKey, loadingPrompt)

    return loadingPrompt
  }

  loadAll(): Promise<readonly AgentPrompt[]> {
    return Promise.all(
      Object.values(AgentRoleValue).map((agent) => this.load(agent))
    )
  }

  async getVersionSnapshot(): Promise<PromptVersionSnapshot> {
    const [investigator, reproducer, implementer, reviewer] =
      await Promise.all([
        this.load(AgentRoleValue.investigator),
        this.load(AgentRoleValue.reproducer),
        this.load(AgentRoleValue.implementer),
        this.load(AgentRoleValue.reviewer)
      ] as const)

    return Object.freeze({
      [AgentRoleValue.investigator]: investigator.id,
      [AgentRoleValue.reproducer]: reproducer.id,
      [AgentRoleValue.implementer]: implementer.id,
      [AgentRoleValue.reviewer]: reviewer.id
    })
  }

  private async readPrompt(
    agent: AgentRole,
    version: PromptVersion
  ): Promise<AgentPrompt> {
    const sourcePath = path.posix.join(agent, `${version}.md`)

    const absolutePath = path.join(
      this.promptsRoot,
      agent,
      `${version}.md`
    )

    let source: string

    try {
      source = await readFile(absolutePath, 'utf8')
    } catch (error) {
      if (isFileNotFoundError(error)) {
        throw new PromptRegistryError(
          `Prompt ${agent}:${version} was not found`,
          PromptRegistryErrorCode.not_found,
          {
            agent,
            version,
            cause: error
          }
        )
      }

      throw new PromptRegistryError(
        `Failed to read prompt ${agent}:${version}`,
        PromptRegistryErrorCode.read_failed,
        {
          agent,
          version,
          cause: error
        }
      )
    }

    return parsePrompt(source, sourcePath, agent, version)
  }
}

function parsePrompt(
  source: string,
  sourcePath: string,
  expectedAgent: AgentRole,
  expectedVersion: PromptVersion
): AgentPrompt {
  const metadata = promptMetadataPattern.exec(source)

  if (metadata === null) {
    throw new PromptRegistryError(
      `Prompt ${sourcePath} does not contain valid metadata`,
      PromptRegistryErrorCode.invalid_metadata,
      {
        agent: expectedAgent,
        version: expectedVersion
      }
    )
  }

  const metadataAgent = metadata[1]
  const metadataVersion = metadata[2]

  const expectedIdentifier = createPromptVersionIdentifier(
    expectedAgent,
    expectedVersion
  )

  if (
    metadataAgent !== expectedAgent ||
    metadataVersion !== expectedIdentifier
  ) {
    throw new PromptRegistryError(
      `Prompt metadata does not match ${sourcePath}`,
      PromptRegistryErrorCode.invalid_metadata,
      {
        agent: expectedAgent,
        version: expectedVersion
      }
    )
  }

  const content = source.slice(metadata[0].length).trim()

  if (content.length === 0) {
    throw new PromptRegistryError(
      `Prompt ${sourcePath} is empty`,
      PromptRegistryErrorCode.invalid_metadata,
      {
        agent: expectedAgent,
        version: expectedVersion
      }
    )
  }

  return Object.freeze({
    id: expectedIdentifier,
    agent: expectedAgent,
    version: expectedVersion,
    content,
    sourcePath
  })
}

function assertPromptVersion(
  version: string,
  agent: AgentRole
): asserts version is PromptVersion {
  if (!promptVersionPattern.test(version)) {
    throw new PromptRegistryError(
      `Invalid prompt version: ${version}`,
      PromptRegistryErrorCode.invalid_version,
      {
        agent,
        version
      }
    )
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && error.code === 'ENOENT'
  )
}
