import type { ModelTool, ModelToolCall } from '~/core/model'
import type { RepositoryTools } from '~/core/workspace'

import { z } from 'zod'
import {
  InvestigatorError,
  InvestigatorErrorCode
} from '~/core/investigation'

const listFilesInputSchema = z.object({}).strict()

const searchCodeInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500),

    caseSensitive: z.boolean().nullable(),

    maxResults: z.number().int().min(1).max(100).nullable()
  })
  .strict()

const readFileInputSchema = z
  .object({
    path: z.string().trim().min(1).max(500),

    lineStart: z.number().int().positive().nullable(),

    lineEnd: z.number().int().positive().nullable()
  })
  .strict()
  .superRefine((input, context) => {
    if (
      typeof input.lineStart !== 'number' ||
      typeof input.lineEnd !== 'number'
    ) {
      return
    }

    if (input.lineEnd < input.lineStart) {
      context.addIssue({
        code: 'custom',
        path: ['lineEnd'],
        message: 'lineEnd must be greater than or equal to lineStart'
      })

      return
    }

    if (input.lineEnd - input.lineStart > 399) {
      context.addIssue({
        code: 'custom',
        path: ['lineEnd'],
        message: 'A single readFile call is limited to 400 lines'
      })
    }
  })

const getWorkspaceRevisionInputSchema = z.object({}).strict()

const investigatorTools: readonly ModelTool[] = [
  {
    name: 'listFiles',
    description:
      'List readable repository files inside the isolated workspace.',
    inputSchema: listFilesInputSchema
  },
  {
    name: 'searchCode',
    description: 'Search repository source lines for an exact text query.',
    inputSchema: searchCodeInputSchema
  },
  {
    name: 'readFile',
    description: 'Read up to 400 lines from one repository-relative file.',
    inputSchema: readFileInputSchema
  },
  {
    name: 'getWorkspaceRevision',
    description:
      'Return the current immutable workspace revision identifier.',
    inputSchema: getWorkspaceRevisionInputSchema
  }
]

export interface InvestigatorToolExecutionResult {
  readonly modelOutput: string
  readonly traceOutput: unknown
}

export class InvestigatorRepositoryTools {
  readonly definitions = investigatorTools

  constructor(private readonly repositoryTools: RepositoryTools) {}

  async execute(
    toolCall: ModelToolCall
  ): Promise<InvestigatorToolExecutionResult> {
    switch (toolCall.name) {
      case 'listFiles':
        return this.listFiles(toolCall.arguments)

      case 'searchCode':
        return this.searchCode(toolCall.arguments)

      case 'readFile':
        return this.readFile(toolCall.arguments)

      case 'getWorkspaceRevision':
        return this.getWorkspaceRevision(toolCall.arguments)

      default:
        throw new InvestigatorError(
          `Unsupported investigator tool: ${toolCall.name}`,
          InvestigatorErrorCode.unsupported_tool
        )
    }
  }

  private async listFiles(
    argumentsValue: unknown
  ): Promise<InvestigatorToolExecutionResult> {
    parseToolArguments(listFilesInputSchema, argumentsValue, 'listFiles')

    const files = await this.repositoryTools.listFiles()

    const output = {
      files,
      totalFiles: files.length
    }

    return {
      modelOutput: JSON.stringify(output),
      traceOutput: output
    }
  }

  private async searchCode(
    argumentsValue: unknown
  ): Promise<InvestigatorToolExecutionResult> {
    const input = parseToolArguments(
      searchCodeInputSchema,
      argumentsValue,
      'searchCode'
    )

    const matches = await this.repositoryTools.searchCode({
      query: input.query,

      ...(input.caseSensitive === null
        ? {}
        : {
            caseSensitive: input.caseSensitive
          }),

      ...(input.maxResults === null
        ? {}
        : {
            maxResults: input.maxResults
          })
    })

    const output = {
      query: input.query,
      matches,
      totalMatches: matches.length
    }

    return {
      modelOutput: JSON.stringify(output),
      traceOutput: output
    }
  }

  private async readFile(
    argumentsValue: unknown
  ): Promise<InvestigatorToolExecutionResult> {
    const input = parseToolArguments(
      readFileInputSchema,
      argumentsValue,
      'readFile'
    )

    const file = await this.repositoryTools.readFile(input.path)
    const lines = file.content.split(/\r?\n/)

    const lineStart = input.lineStart ?? 1

    if (lineStart > lines.length) {
      throw new InvestigatorError(
        `readFile lineStart ${lineStart} exceeds ` +
          `${lines.length} lines in ${input.path}`,
        InvestigatorErrorCode.invalid_tool_arguments,
        {
          retryable: true
        }
      )
    }

    const requestedLineEnd = input.lineEnd ?? lineStart + 399

    const lineEnd = Math.min(requestedLineEnd, lines.length)

    const content = lines.slice(lineStart - 1, lineEnd).join('\n')

    const output = {
      path: file.path,
      sizeBytes: file.sizeBytes,
      lineStart,
      lineEnd,
      totalLines: lines.length,
      truncated: lineStart > 1 || lineEnd < lines.length,
      content
    }

    return {
      modelOutput: JSON.stringify(output),
      traceOutput: output
    }
  }

  private async getWorkspaceRevision(
    argumentsValue: unknown
  ): Promise<InvestigatorToolExecutionResult> {
    parseToolArguments(
      getWorkspaceRevisionInputSchema,
      argumentsValue,
      'getWorkspaceRevision'
    )

    const workspaceRevision =
      await this.repositoryTools.getWorkspaceRevision()

    const output = {
      workspaceRevision
    }

    return {
      modelOutput: JSON.stringify(output),
      traceOutput: output
    }
  }
}

function parseToolArguments<TOutput>(
  schema: z.ZodType<TOutput>,
  value: unknown,
  toolName: string
): TOutput {
  const result = schema.safeParse(value)

  if (!result.success) {
    throw new InvestigatorError(
      `Invalid arguments for ${toolName}: ` +
        z.prettifyError(result.error),
      InvestigatorErrorCode.invalid_tool_arguments,
      {
        retryable: true,
        cause: result.error
      }
    )
  }

  return result.data
}
