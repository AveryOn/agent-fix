import dotenv from 'dotenv'
import { parseEnvironment } from '~/core/config/environment'

const environmentFile =
  process.env.NODE_ENV === 'test' ? '.env.test' : '.env'

dotenv.config({
  path: environmentFile
})

export const env = parseEnvironment(process.env)
