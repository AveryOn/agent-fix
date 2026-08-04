import type {
  TestSourceFile,
  TestStructureSnapshot
} from '~/core/reproduction'
import type { RepositoryFile, RepositoryTools } from '~/core/workspace'

const defaultMaximumTestFiles = 12
const defaultMaximumContentLength = 80_000

export interface TestStructureInspectorOptions {
  readonly maximumTestFiles?: number
  readonly maximumContentLength?: number
}

export class TestStructureInspector {
  private readonly maximumTestFiles: number
  private readonly maximumContentLength: number

  constructor(options: TestStructureInspectorOptions = {}) {
    this.maximumTestFiles =
      options.maximumTestFiles ?? defaultMaximumTestFiles

    this.maximumContentLength =
      options.maximumContentLength ?? defaultMaximumContentLength
  }

  async inspect(
    repositoryTools: RepositoryTools,
    workspaceRevision: string
  ): Promise<TestStructureSnapshot> {
    const repositoryFiles = await repositoryTools.listFiles()

    const packageFile = repositoryFiles.find(
      (file) => file.path === 'package.json'
    )

    const configFiles = repositoryFiles
      .filter(isTestConfigFile)
      .sort(compareRepositoryFiles)

    const testFiles = repositoryFiles
      .filter(isTestSourceFile)
      .sort(compareRepositoryFiles)
      .slice(0, this.maximumTestFiles)

    let remainingContentLength = this.maximumContentLength

    const loadedConfigFiles: TestSourceFile[] = []
    const loadedTestFiles: TestSourceFile[] = []

    let packageContent: string | null = null

    if (packageFile !== undefined) {
      const loadedPackage = await this.readBoundedFile(
        packageFile,
        repositoryTools,
        remainingContentLength
      )

      loadedConfigFiles.push(loadedPackage.file)

      remainingContentLength -= loadedPackage.consumedLength

      packageContent = loadedPackage.file.content
    }

    for (const file of configFiles) {
      if (file.path === 'package.json' || remainingContentLength <= 0) {
        continue
      }

      const loaded = await this.readBoundedFile(
        file,
        repositoryTools,
        remainingContentLength
      )

      loadedConfigFiles.push(loaded.file)

      remainingContentLength -= loaded.consumedLength
    }

    for (const file of testFiles) {
      if (remainingContentLength <= 0) {
        break
      }

      const loaded = await this.readBoundedFile(
        file,
        repositoryTools,
        remainingContentLength
      )

      loadedTestFiles.push(loaded.file)

      remainingContentLength -= loaded.consumedLength
    }

    const packageMetadata = parsePackageMetadata(packageContent)

    return {
      framework: packageMetadata.framework,
      testScript: packageMetadata.testScript,
      configFiles: loadedConfigFiles,
      testFiles: loadedTestFiles,
      workspaceRevision
    }
  }

  private async readBoundedFile(
    file: RepositoryFile,
    repositoryTools: RepositoryTools,
    maximumLength: number
  ): Promise<{
    readonly file: TestSourceFile
    readonly consumedLength: number
  }> {
    const result = await repositoryTools.readFile(file.path)

    const content = result.content.slice(0, maximumLength)

    return {
      file: {
        path: result.path,
        content,
        truncated: content.length < result.content.length
      },
      consumedLength: content.length
    }
  }
}

interface PackageMetadata {
  readonly framework: string | null
  readonly testScript: string | null
}

function parsePackageMetadata(content: string | null): PackageMetadata {
  if (content === null) {
    return {
      framework: null,
      testScript: null
    }
  }

  try {
    const parsed: unknown = JSON.parse(content)
    const packageRecord = toRecord(parsed)

    if (packageRecord === null) {
      return {
        framework: null,
        testScript: null
      }
    }

    const scripts = toStringRecord(packageRecord.scripts)

    const dependencies = {
      ...toStringRecord(packageRecord.dependencies),
      ...toStringRecord(packageRecord.devDependencies)
    }

    return {
      framework: detectTestFramework(dependencies, scripts.test),
      testScript: scripts.test ?? null
    }
  } catch {
    return {
      framework: null,
      testScript: null
    }
  }
}

function detectTestFramework(
  dependencies: Readonly<Record<string, string>>,
  testScript: string | undefined
): string | null {
  if ('vitest' in dependencies) {
    return 'vitest'
  }

  if ('jest' in dependencies) {
    return 'jest'
  }

  if ('mocha' in dependencies) {
    return 'mocha'
  }

  if ('@playwright/test' in dependencies) {
    return 'playwright'
  }

  if (testScript !== undefined && testScript.includes('node --test')) {
    return 'node:test'
  }

  return null
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    return null
  }

  return value as Record<string, unknown>
}

function toStringRecord(value: unknown): Record<string, string> {
  const record = toRecord(value)

  if (record === null) {
    return {}
  }

  const result: Record<string, string> = {}

  for (const [key, nestedValue] of Object.entries(record)) {
    if (typeof nestedValue === 'string') {
      result[key] = nestedValue
    }
  }

  return result
}

function isTestConfigFile(file: RepositoryFile): boolean {
  return (
    file.path === 'package.json' ||
    /(^|\/)(vitest|jest|playwright)\.config\.[cm]?[jt]s$/.test(
      file.path
    ) ||
    /(^|\/)tsconfig(?:\.[a-zA-Z0-9_-]+)?\.json$/.test(file.path)
  )
}

function isTestSourceFile(file: RepositoryFile): boolean {
  const normalizedPath = file.path.toLowerCase()
  const fileName = normalizedPath.split('/').at(-1) ?? ''

  const testDirectory =
    normalizedPath.startsWith('test/') ||
    normalizedPath.startsWith('tests/') ||
    normalizedPath.includes('/test/') ||
    normalizedPath.includes('/tests/') ||
    normalizedPath.includes('/__tests__/')

  const testFileName =
    fileName.includes('.test.') || fileName.includes('.spec.')

  return (
    /\.(?:[cm]?[jt]sx?)$/.test(fileName) && (testDirectory || testFileName)
  )
}

function compareRepositoryFiles(
  left: RepositoryFile,
  right: RepositoryFile
): number {
  return left.path.localeCompare(right.path)
}
