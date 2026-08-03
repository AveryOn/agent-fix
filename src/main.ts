import { CompositionRoot } from '~/composition-root'

const Root = new CompositionRoot()

let shutdownPromise: Promise<void> | undefined

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownPromise !== undefined) {
    return shutdownPromise
  }

  removeSignalHandlers()

  shutdownPromise = (async () => {
    console.log(`[AgentFix] Received ${signal}`)

    try {
      await Root.app.stop()

      console.log('[AgentFix] Application stopped')
    } catch (error) {
      console.error('[AgentFix] Failed to stop application', error)

      process.exitCode = 1
    }
  })()

  return shutdownPromise
}

function handleSigint(): void {
  void shutdown('SIGINT')
}

function handleSigterm(): void {
  void shutdown('SIGTERM')
}

function removeSignalHandlers(): void {
  process.off('SIGINT', handleSigint)
  process.off('SIGTERM', handleSigterm)
}

async function bootstrap(): Promise<void> {
  process.once('SIGINT', handleSigint)
  process.once('SIGTERM', handleSigterm)

  try {
    await Root.app.start()

    console.log('[AgentFix] Application started')
  } catch (error) {
    removeSignalHandlers()

    console.error('[AgentFix] Failed to start application', error)

    try {
      await Root.app.stop()
    } catch (shutdownError) {
      console.error(
        '[AgentFix] Failed to clean up after startup error',
        shutdownError
      )
    }

    process.exitCode = 1
  }
}

await bootstrap()
