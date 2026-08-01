import { spawnSync } from 'node:child_process'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const rootDirectory = process.cwd()
const outputFileName = 'project_whole_code_source.json'
const outputFilePath = path.resolve(rootDirectory, outputFileName)
const excludedFiles = ['package-lock.json', 'README.md']

function getRepositoryFiles() {
  const result = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: rootDirectory,
      encoding: 'utf8',
      maxBuffer: 100 * 1024 * 1024
    }
  )

  if (result.error) {
    throw new Error(`Не удалось запустить Git: ${result.error.message}`)
  }

  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || `Git завершился с кодом ${result.status}`
    )
  }

  return result.stdout
    .split('\0')
    .filter(Boolean)
    .filter((relativePath) => {
      if (excludedFiles.includes(relativePath)) {
        return false
      }
      const absolutePath = path.resolve(rootDirectory, relativePath)

      // Не добавляем предыдущий сгенерированный файл в новый результат.
      return absolutePath !== outputFilePath
    })
    .sort((left, right) => left.localeCompare(right))
}

async function generateProjectSource() {
  const files = getRepositoryFiles()
  const projectSource = []

  for (const relativePath of files) {
    const absolutePath = path.resolve(rootDirectory, relativePath)
    const fileStat = await stat(absolutePath).catch(() => null)

    if (!fileStat?.isFile()) {
      continue
    }

    const codeSource = await readFile(absolutePath, 'utf8')

    projectSource.push({
      path: relativePath.replaceAll(path.sep, '/'),
      code_source: codeSource
    })
  }

  await writeFile(
    outputFilePath,
    `${JSON.stringify(projectSource, null, 2)}\n`,
    'utf8'
  )

  console.log(`Файл создан: ${outputFileName}`)
  console.log(`Добавлено файлов: ${projectSource.length}`)
}

generateProjectSource().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
