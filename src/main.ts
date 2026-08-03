// import type { CliPort } from '~/infra/cli'

// import { Module } from '~/core/di/di.module'
// import { CLI_PORT } from '~/infra/cli'

// const cliModule = Module.resolve<CliPort>(CLI_PORT)

function shutdown(signal: NodeJS.Signals): void {
  console.log(`[multi-agent-system] Received ${signal}`)

  // cliModule.close((error) => {
  //   if (error !== undefined) {
  //     console.error(
  //       '[multi-agent-system] Failed to close CLI process',
  //       error
  //     )

  //     process.exitCode = 1
  //     return
  //   }

  //   console.log('[multi-agent-system] CLI process stopped')
  //   process.exitCode = 0
  // })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
