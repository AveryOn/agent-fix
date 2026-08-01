import 'reflect-metadata'

import type { DiContainerPort } from '~/core/di/ports/di.container.port'
import type {
  ClassConstructor,
  DiProvider,
  DiToken,
  InjectMetadata
} from '~/core/di/types'

const INJECT_METADATA_KEY = Symbol.for('di:inject')
const INJECTABLE_METADATA_KEY = Symbol.for('di:injectable')
const MODULE_METADATA = Symbol.for('di:module')

export class DiContainer implements DiContainerPort {
  private readonly providers = new Map<DiToken, DiProvider>()
  private readonly instances = new Map<DiToken, unknown>()

  register(provider: DiProvider): void
  register(providers: DiProvider[]): void
  register(_providers: DiProvider | DiProvider[]): void {
    const providers = Array.isArray(_providers) ? _providers : [_providers]

    for (const provider of providers) {
      console.log('Provider Register:', provider.token)
      this.providers.set(provider.token, provider)
    }
  }

  resolve<T = unknown>(token: DiToken): T {
    if (this.instances.has(token)) {
      return this.instances.get(token) as T
    }

    const provider = this.providers.get(token)

    if (!provider) {
      throw new Error(
        `Provider is not registered: ${this.formatToken(token)}`
      )
    }

    const instance = this.createInstance(provider)

    this.instances.set(token, instance)

    return instance as T
  }

  private createInstance(provider: DiProvider): unknown {
    if ('useValue' in provider) {
      return provider.useValue
    }

    if ('useFactory' in provider) {
      const dependencies =
        provider.inject?.map((token) => this.resolve(token)) ?? []

      return provider.useFactory(...dependencies)
    }

    if ('useClass' in provider) {
      const TargetClass = provider.useClass

      if (!this.isInjectable(TargetClass)) {
        throw new Error(`Class is not injectable: ${TargetClass.name}`)
      }

      const dependencies = this.resolveClassDependencies(TargetClass)

      return new TargetClass(...dependencies)
    }

    throw new Error('Invalid DI provider')
  }

  private resolveClassDependencies(target: ClassConstructor): unknown[] {
    const metadata = this.getInjectMetadata(target)
    const dependencies: unknown[] = []

    for (const dependency of metadata) {
      dependencies[dependency.index] = this.resolve(dependency.token)
    }

    return dependencies
  }

  private getInjectMetadata(target: ClassConstructor): InjectMetadata[] {
    return (
      (Reflect.getMetadata(INJECT_METADATA_KEY, target) as
        InjectMetadata[] | undefined) ?? []
    )
  }

  private isInjectable(target: ClassConstructor): boolean {
    return Reflect.getMetadata(INJECTABLE_METADATA_KEY, target) === true
  }

  private formatToken(token: DiToken): string {
    if (typeof token === 'string') {
      return token
    }

    if (typeof token === 'symbol') {
      return token.description ?? token.toString()
    }

    if (typeof token === 'function') {
      return token.name || 'AnonymousClass'
    }

    return 'UnknownToken'
  }
}

export function Injectable(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(INJECTABLE_METADATA_KEY, true, target)
  }
}

export function Inject(token: DiToken): ParameterDecorator {
  return (target, _propertyKey, parameterIndex) => {
    const existingMetadata =
      (Reflect.getMetadata(INJECT_METADATA_KEY, target) as
        InjectMetadata[] | undefined) ?? []

    existingMetadata.push({
      index: parameterIndex,
      token
    })

    Reflect.defineMetadata(INJECT_METADATA_KEY, existingMetadata, target)
  }
}

export function Module(providers: DiProvider[]): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(
      MODULE_METADATA,
      { example: 'HELLO WORLD!' },
      target
    )

    console.debug({
      target,
      providers,
      av: Reflect.getMetadata(MODULE_METADATA, target) as Record<
        string,
        unknown
      >
    })
  }
}
