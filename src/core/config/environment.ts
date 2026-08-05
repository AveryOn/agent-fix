import { z } from 'zod'

const booleanEnvironmentVariableSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  RUNS_ROOT: z.string().min(1).default('.runs'),

  MAX_AGENT_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),

  COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  CONTEXT_TOKEN_BUDGET: z.coerce.number().int().positive().default(16_000),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  LOG_PRETTY: booleanEnvironmentVariableSchema.default(false),

  DOCKER_ENABLED: booleanEnvironmentVariableSchema.default(false),

  DOCKER_IMAGE: z.string().min(1).default('agent-fix-sandbox:local'),

  DOCKER_MEMORY_MB: z.coerce.number().int().min(128).default(512),

  DOCKER_CPUS: z.coerce.number().positive().max(8).default(1),

  DOCKER_PIDS_LIMIT: z.coerce.number().int().min(16).max(4096).default(256)
})

export type Environment = z.infer<typeof environmentSchema>

export class EnvironmentValidationError extends Error {
  constructor(error: z.ZodError) {
    super(`Invalid environment variables:\n${z.prettifyError(error)}`, {
      cause: error
    })

    this.name = 'EnvironmentValidationError'
  }
}

export function parseEnvironment(values: NodeJS.ProcessEnv): Environment {
  const result = environmentSchema.safeParse(values)

  if (!result.success) {
    throw new EnvironmentValidationError(result.error)
  }

  return result.data
}
