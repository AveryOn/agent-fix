export interface TokenEstimator {
  estimate(value: unknown): number
}

export class ApproximateTokenEstimator implements TokenEstimator {
  estimate(value: unknown): number {
    const serialized = JSON.stringify(value) ?? ''

    return Math.ceil(serialized.length / 4)
  }
}
