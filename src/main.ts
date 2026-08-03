import { CompositionRoot } from '~/composition-root'

const root = new CompositionRoot()
const bootstrapLogger = root.logger.child({
  step: 'bootstrap'
})

let shutdownPromise: Promise<void> | undefined

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownPromise !== undefined) {
    return shutdownPromise
  }

  removeSignalHandlers()

  shutdownPromise = (async () => {
    const shutdownLogger = root.logger.child({
      step: 'shutdown'
    })

    shutdownLogger.info(`Received ${signal}`)

    try {
      await root.app.stop()

      shutdownLogger.info('Application stopped')
    } catch (error) {
      shutdownLogger.error('Failed to stop application', {
        error
      })

      process.exitCode = 1
    } finally {
      await flushObservability()
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

async function flushObservability(): Promise<void> {
  try {
    await root.traceRecorder.flush()
  } catch (error) {
    root.logger.error('Failed to flush trace events', {
      error
    })

    process.exitCode = 1
  }

  root.logger.flush()
}

async function bootstrap(): Promise<void> {
  process.once('SIGINT', handleSigint)
  process.once('SIGTERM', handleSigterm)

  try {
    await root.app.start()

    bootstrapLogger.info('Application started')
    root.logger.flush()
  } catch (error) {
    removeSignalHandlers()

    bootstrapLogger.error('Failed to start application', {
      error
    })

    try {
      await root.app.stop()
    } catch (shutdownError) {
      bootstrapLogger.error('Failed to clean up after startup error', {
        error: shutdownError
      })
    }

    process.exitCode = 1

    await flushObservability()
  }
}

await bootstrap()
