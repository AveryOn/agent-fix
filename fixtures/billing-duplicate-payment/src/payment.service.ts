export interface Payment {
  readonly id: string
  readonly providerEventId: string
  readonly amount: number
  readonly currency: string
  readonly createdAt: string
}

export interface CreatePaymentInput {
  readonly providerEventId: string
  readonly amount: number
  readonly currency: string
}

export class PaymentService {
  private readonly payments: Payment[] = []

  createPayment(input: CreatePaymentInput): Payment {
    const payment: Payment = {
      id: `payment-${this.payments.length + 1}`,
      providerEventId: input.providerEventId,
      amount: input.amount,
      currency: input.currency,
      createdAt: new Date().toISOString()
    }

    this.payments.push(payment)

    return payment
  }

  getPayments(): readonly Payment[] {
    return [...this.payments]
  }

  clear(): void {
    this.payments.length = 0
  }
}
