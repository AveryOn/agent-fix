import type { RunCommandHandler } from '~/application/run'
import type { Cli, CliOutput } from '~/core/cli'
import type { Logger } from '~/core/logging'

import path from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { CliUsageError } from '~/core/cli'

interface HelpCommand {
  readonly type: 'help'
}

interface RunCommand {
  readonly type: 'run'
  readonly repositoryPath: string
  readonly task: string
}

type ParsedCliCommand = HelpCommand | RunCommand

const runCommandSchema = z.object({
  repositoryPath: z.string().trim().min(1, 'Repository path is required'),

  task: z
    .string()
    .trim()
    .min(1, 'Bug description is required')
    .max(10_000, 'Bug description exceeds 10000 characters')
})

export class AgentFixCli implements Cli {
  constructor(
    private readonly runCommandHandler: RunCommandHandler,
    private readonly output: CliOutput,
    private readonly logger: Logger
  ) {}

  async execute(argv: readonly string[]): Promise<number> {
    try {
      const command = parseCliCommand(argv)

      if (command.type === 'help') {
        this.output.writeLine(getHelpText())
        return 0
      }

      return await this.runCommandHandler.execute({
        repositoryPath: command.repositoryPath,
        task: command.task
      })
    } catch (error) {
      const message = getErrorMessage(error)

      if (error instanceof CliUsageError) {
        this.logger.warn('Invalid CLI arguments', {
          message
        })

        this.output.writeError(`Error: ${message}`)
        this.output.writeLine('')
        this.output.writeLine(getHelpText())

        return 1
      }

      this.logger.error('CLI execution failed', {
        error
      })

      this.output.writeError(`Error: ${message}`)

      return 1
    }
  }
}

export function parseCliCommand(
  argv: readonly string[],
  cwd: string = process.cwd()
): ParsedCliCommand {
  let parsed: ReturnType<typeof parseArgs>

  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        repo: {
          type: 'string'
        },
        task: {
          type: 'string'
        },
        help: {
          type: 'boolean',
          short: 'h'
        }
      }
    })
  } catch (error) {
    throw new CliUsageError(getErrorMessage(error))
  }

  if (parsed.values.help === true) {
    return {
      type: 'help'
    }
  }

  const [command, ...extraPositionals] = parsed.positionals

  if (command === undefined) {
    return {
      type: 'help'
    }
  }

  if (command !== 'run') {
    throw new CliUsageError(`Unknown command: ${command}`)
  }

  if (extraPositionals.length > 0) {
    throw new CliUsageError(
      `Unexpected arguments: ${extraPositionals.join(' ')}`
    )
  }

  const result = runCommandSchema.safeParse({
    repositoryPath: parsed.values.repo,
    task: parsed.values.task
  })

  if (!result.success) {
    throw new CliUsageError(z.prettifyError(result.error))
  }

  return {
    type: 'run',
    repositoryPath: path.resolve(cwd, result.data.repositoryPath),
    task: result.data.task
  }
}

function getHelpText(): string {
  return [
    'AgentFix',
    '',
    'Usage:',
    '  npm run dev -- run --repo <path> --task <description>',
    '',
    'Options:',
    '  --repo <path>         target Git repository',
    '  --task <description>  bug description',
    '  -h, --help            display help'
  ].join('\n')
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown CLI error'
}
