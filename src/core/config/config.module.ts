import { CONFIG_PORT } from '~/core/config/config.port'
import { Module } from '~/core/di'
import { Module as m } from '~/core/di/di.module'
import { env } from '~/env'

export default m.register([
  {
    token: CONFIG_PORT,
    useValue: {
      env
    }
  }
])

@Module([
  {
    token: CONFIG_PORT,
    useValue: {
      env
    }
  }
])
export class ConfigModule {}
