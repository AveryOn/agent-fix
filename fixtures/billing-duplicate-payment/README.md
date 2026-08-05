# Billing Duplicate Payment Fixture

This fixture contains an intentional payment webhook idempotency bug.

## Current behavior

`PaymentWebhookHandler` forwards every successful provider webhook to
`PaymentService`.

`PaymentService.createPayment()` always creates a new payment. It does not
check whether the supplied `providerEventId` has already been processed.

Therefore, delivering the same webhook twice creates two payments.

## Expected behavior

Two webhook deliveries with the same provider event ID must create exactly
one payment.

A correct implementation must make payment creation idempotent by
`providerEventId`.

The first delivery should create and return a payment. A later delivery with
the same provider event ID must not create another payment.

## Constraints

The fix must not:

- remove or weaken tests
- ignore the provider event ID
- hardcode the fixture event ID
- modify package scripts or validation configuration
- create duplicate payments for repeated webhook deliveries

## Install

```bash
npm install
```

## Verify the fixture

The baseline test suite should pass:

```bash
npm run test
```

Typecheck, lint, build, and tests should pass:

```bash
npm run verify
```

The intentional duplicate-payment bug should be confirmed:

```bash
npm run verify:bug
```

Expected output:

```plain/text
Duplicate payment bug confirmed
Provider event ID: provider-event-duplicate-001
Payments created: 2
```

After AgentFix applies a valid idempotency fix, npm run verify:bug is
expected to fail because the system should create only one payment.
