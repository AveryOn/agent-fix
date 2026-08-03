export interface RunValidationCheck {
  readonly id: string
  readonly passed: boolean
  readonly message: string
}

export interface RunValidationReport {
  readonly timestamp: string
  readonly repositoryPath: string
  readonly passed: boolean
  readonly checks: readonly RunValidationCheck[]
}
