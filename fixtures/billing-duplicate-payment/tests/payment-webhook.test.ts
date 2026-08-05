import { beforeEach, describe, expect, it } from 'vitest'

import { PaymentService } from '../src/payment.service.js'
import {
  PaymentWebhookHandler,
  type PaymentWebhook
} from '../src/webhook.handler.js'

describe('PaymentWebhookHandler', () => {
  let paymentService: PaymentService
  let webhookHandler: PaymentWebhookHandler

  beforeEach(() => {
    paymentService = new PaymentService()
    webhookHandler = new PaymentWebhookHandler(paymentService)
  })

  it('creates a payment from a successful provider webhook', () => {
    const webhook = createWebhook()

    const payment = webhookHandler.handle(webhook)

    expect(payment).toMatchObject({
      providerEventId: webhook.id,
      amount: 2500,
      currency: 'USD'
    })

    expect(paymentService.getPayments()).toHaveLength(1)
  })

  it('preserves the provider event identifier', () => {
    const webhook = createWebhook({
      id: 'provider-event-002'
    })

    webhookHandler.handle(webhook)

    expect(paymentService.getPayments()[0]?.providerEventId).toBe(
      'provider-event-002'
    )
  })
})

function createWebhook(
  overrides: Partial<PaymentWebhook> = {}
): PaymentWebhook {
  return {
    id: 'provider-event-001',
    type: 'payment.succeeded',
    data: {
      amount: 2500,
      currency: 'USD'
    },
    ...overrides
  }
}
