import { PaymentService } from '../src/payment.service.js'
import {
  PaymentWebhookHandler,
  type PaymentWebhook
} from '../src/webhook.handler.js'

const paymentService = new PaymentService()
const webhookHandler = new PaymentWebhookHandler(paymentService)

const webhook: PaymentWebhook = {
  id: 'provider-event-duplicate-001',
  type: 'payment.succeeded',
  data: {
    amount: 2500,
    currency: 'USD'
  }
}

webhookHandler.handle(webhook)
webhookHandler.handle(webhook)

const payments = paymentService.getPayments()

if (payments.length !== 2) {
  throw new Error(
    `Expected the fixture bug to create 2 payments, received ${payments.length}`
  )
}

if (payments.some((payment) => payment.providerEventId !== webhook.id)) {
  throw new Error(
    'Expected both payments to contain the same provider event ID'
  )
}

console.log('Duplicate payment bug confirmed')
console.log(`Provider event ID: ${webhook.id}`)
console.log(`Payments created: ${payments.length}`)
