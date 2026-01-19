# Processing Modes Showcase

Demonstrates the three job processing modes in Queuert through an order fulfillment workflow.

## What it demonstrates

- **Atomic mode** for operations that must succeed or fail together
- **Staged mode** for jobs with external API calls or long processing
- **Auto-setup** for simple jobs that don't need explicit control
- Job chain continuations across different processing modes

## Processing modes explained

### Atomic Mode (`reserve-inventory`)

Prepare and complete run in ONE transaction. Use when reads and writes must be atomic.

**Why atomic here?** We read stock, check availability, then decrement. Both must be in the same transaction to prevent race conditions (two orders reading "5 in stock" simultaneously).

```ts
const order = await prepare({ mode: "atomic" }, async ({ sql }) => {
  const [row] = await sql`SELECT stock, quantity FROM orders WHERE id = ${id}`;
  if (row.stock < row.quantity) throw new Error("Insufficient stock");
  return row;
});

// Complete runs in SAME transaction as prepare
return complete(async ({ sql, continueWith }) => {
  await sql`UPDATE products SET stock = stock - ${order.quantity} WHERE ...`;
  return continueWith({ typeName: "charge-payment", input: { ... } });
});
```

### Staged Mode (`charge-payment`)

Prepare and complete run in SEPARATE transactions. Use for external API calls.

**Why staged here?** We call a payment API which is slow. We don't want to hold a database transaction open during the API call.

```ts
// Phase 1: Prepare (transaction)
const orderId = await prepare({ mode: "staged" }, async ({ sql }) => {
  const [row] = await sql`SELECT id, status FROM orders WHERE id = ${id}`;
  return row.id;
});
// Transaction closed, lease renewal active

// Phase 2: Processing (no transaction)
const { paymentId } = await chargePaymentAPI(amount);

// Phase 3: Complete (new transaction)
return complete(async ({ sql, continueWith }) => {
  await sql`UPDATE orders SET payment_id = ${paymentId} WHERE id = ${orderId}`;
  return continueWith({ typeName: "send-confirmation", input: { ... } });
});
```

### Auto-Setup Mode (`send-confirmation`)

Just call `complete()` without `prepare()`. The system determines the mode automatically.

**Why auto here?** Simple jobs that don't need explicit control over transaction boundaries.

```ts
// No prepare() call - just do work and complete
await sendEmail();

return complete(async ({ sql }) => {
  await sql`UPDATE orders SET status = 'confirmed' WHERE id = ${id}`;
  return { confirmedAt: new Date().toISOString() };
});
```

## What it does

1. Starts PostgreSQL via testcontainers
2. Creates `products` and `orders` tables with seed data
3. Creates an order for 2 widgets (stock starts at 5)
4. Starts the fulfillment workflow:
   - **reserve-inventory** (atomic): Checks stock, decrements, updates order to "reserved"
   - **charge-payment** (staged): Calls payment API, records payment ID
   - **send-confirmation** (auto): Updates order to "confirmed"
5. Verifies final state: order confirmed, stock reduced to 3

## Running the example

```bash
pnpm install
pnpm start
```

Expected output:

```
============================================================
PROCESSING MODES SHOWCASE
============================================================

Created order #1 for 2x Widget Pro

[reserve-inventory] ATOMIC mode
  Reading order and checking stock...
  Decrementing stock and updating order...
  Transaction committed!

[charge-payment] STAGED mode
  Loading order...
  Transaction closed, calling external API...
  [Payment API] Processing $199.98...
  Payment complete: pay_1234567890
  Recording payment...
  Transaction committed!

[send-confirmation] AUTO-SETUP mode
  Sending confirmation for order 1...

============================================================
WORKFLOW COMPLETED
============================================================
Order status: confirmed
Product stock: 3 (was 5, ordered 2)
Payment ID: pay_1234567890
Confirmed at: 2026-01-19T...
```
