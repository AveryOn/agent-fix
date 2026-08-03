import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config({
  path: `.env.${process.env.NODE_ENV ?? 'development'}`
})

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  LOG_PRETTY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true')
})

const result = envSchema.safeParse(process.env)

if (!result.success) {
  console.error('Invalid environment variables:')

  console.error(z.prettifyError(result.error))

  process.exit(1)
}

export const env = result.data
export type Environment = z.infer<typeof envSchema>
