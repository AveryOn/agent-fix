import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config({
  path: `.env.${process.env.NODE_ENV ?? 'development'}`
})

const booleanSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),

  RUNS_ROOT: z.string().min(1).default('.runs'),

  MAX_AGENT_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),

  COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  CONTEXT_TOKEN_BUDGET: z.coerce.number().int().positive().default(16_000),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  LOG_PRETTY: booleanSchema.default(false),

  DOCKER_ENABLED: booleanSchema.default(false)
})

const result = envSchema.safeParse(process.env)

if (!result.success) {
  console.error('Invalid environment variables:')
  console.error(z.prettifyError(result.error))

  process.exit(1)
}

export const env = result.data
export type Environment = z.infer<typeof envSchema>
