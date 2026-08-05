import type { Payment } from './payment.service.js'

import { PaymentService } from './payment.service.js'

export interface PaymentWebhook {
  readonly id: string
  readonly type: 'payment.succeeded'
  readonly data: {
    readonly amount: number
    readonly currency: string
  }
}

export class PaymentWebhookHandler {
  constructor(private readonly paymentService: PaymentService) {}

  handle(webhook: PaymentWebhook): Payment {
    return this.paymentService.createPayment({
      providerEventId: webhook.id,
      amount: webhook.data.amount,
      currency: webhook.data.currency
    })
  }
}
