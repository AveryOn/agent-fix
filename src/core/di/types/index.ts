/* eslint-disable @typescript-eslint/no-explicit-any */
export type DiToken =
  | string
  | symbol
  | {
      readonly prototype: unknown
    }

export type ClassConstructor<T = unknown> = new (
  ...dependencies: any[]
) => T

export interface ValueDiProvider<T = unknown> {
  token: DiToken
  useValue: T
}

export interface ClassDiProvider<T = unknown> {
  token: DiToken
  useClass: ClassConstructor<T>
}

export interface FactoryDiProvider<T = unknown> {
  token: DiToken
  useFactory: (...dependencies: any[]) => T
  inject?: DiToken[]
}

export type DiProvider<T = unknown> =
  ValueDiProvider<T> | ClassDiProvider<T> | FactoryDiProvider<T>

export interface InjectMetadata {
  index: number
  token: DiToken
}
