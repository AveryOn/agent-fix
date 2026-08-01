import type { DiProvider, DiToken } from '~/core/di/types'

export abstract class DiContainerPort {
  abstract register(provider: DiProvider): void
  abstract register(providers: DiProvider[]): void
  abstract register(providerOrProviders: DiProvider | DiProvider[]): void

  abstract resolve<T = unknown>(token: DiToken): T
}
