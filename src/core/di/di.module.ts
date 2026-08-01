// import type { DiContainerPort } from '~/core/di/ports/di.container.port'
// import type { DiProvider } from '~/core/di/types'

import { DiContainer } from '~/core/di/di.container'

// export class DiModule {
//   private readonly container: DiContainerPort

//   constructor() {
//     this.container =
//   }

//   // bootstrap(providers: DiProvider[]): DiContainerPort {
//   //   this.container.register(providers)

//   //   return this.container
//   // }
// }

export const Module = new DiContainer()
