# Features Showcase

A comprehensive demonstration of Queuert features through real-world scenarios.

## What it demonstrates

### Processing Modes (Order Fulfillment)

Shows the three job processing modes through an e-commerce order workflow:

- **Atomic mode** (`reserve-inventory`): Prepare and complete in ONE transaction
- **Staged mode** (`charge-payment`): Separate transactions with external API calls
- **Auto-setup** (`send-confirmation`): Simple jobs without explicit control

### Chain Patterns (Subscription Lifecycle)

Shows job chain execution patterns through a SaaS subscription workflow:

- **Linear**: `create-subscription` -> `activate-trial` (sequential execution)
- **Branched**: `trial-decision` -> `convert-to-paid` | `expire-trial` (conditional paths)
- **Loops**: `charge-billing` -> `charge-billing` (recurring billing cycles)
- **Go-to**: Multiple paths lead to `cancel-subscription` (jump to any type)

## File structure

```
src/
  index.ts           # Entry point - runs all showcases
  setup.ts           # Shared PostgreSQL, adapters, utilities
  processing-modes.ts # Order fulfillment workflow
  chain-patterns.ts   # Subscription lifecycle workflow
```

## Processing Modes explained

### Atomic Mode

Use when reads and writes MUST be in the same transaction:

```ts
const order = await prepare({ mode: "atomic" }, async ({ sql }) => {
  // Read + validation in transaction
  const [row] = await sql`SELECT stock FROM products WHERE id = ${id}`;
  if (row.stock < quantity) throw new Error("Insufficient stock");
  return row;
});

// Complete runs in SAME transaction
return complete(async ({ sql, continueWith }) => {
  await sql`UPDATE products SET stock = stock - ${quantity} WHERE ...`;
  return continueWith({ typeName: "next-step", input: { ... } });
});
```

### Staged Mode

Use for external API calls or long-running operations:

```ts
const orderId = await prepare({ mode: "staged" }, async ({ sql }) => {
  const [row] = await sql`SELECT id FROM orders WHERE id = ${id}`;
  return row.id;
});
// Transaction closed, lease renewal active

const { paymentId } = await externalPaymentAPI(amount); // No transaction held

return complete(async ({ sql, continueWith }) => {
  await sql`UPDATE orders SET payment_id = ${paymentId} WHERE id = ${orderId}`;
  return continueWith({ typeName: "next-step", input: { ... } });
});
```

### Auto-Setup Mode

For simple jobs without explicit transaction control:

```ts
return complete(async ({ sql }) => {
  await sql`UPDATE orders SET status = 'done' WHERE id = ${id}`;
  return { completedAt: new Date().toISOString() };
});
```

## Chain Patterns explained

### Linear

Jobs execute one after another: `A -> B -> C`

```ts
type Definitions = {
  step1: { entry: true; input: {...}; continueWith: { typeName: 'step2' } };
  step2: { input: {...}; continueWith: { typeName: 'step3' } };
  step3: { input: {...}; output: {...} };
};
```

### Branched

Jobs conditionally continue to different types: `A -> B1 | B2`

```ts
type Definitions = {
  decision: {
    entry: true;
    input: { value: number };
    continueWith: { typeName: 'path-a' | 'path-b' }; // Union type
  };
  'path-a': { input: {...}; output: {...} };
  'path-b': { input: {...}; output: {...} };
};

// In processor:
return complete(async ({ continueWith }) => {
  return continueWith({
    typeName: condition ? "path-a" : "path-b",
    input: { ... },
  });
});
```

### Loops

Jobs can continue to the same type: `A -> A -> A -> done`

```ts
type Definitions = {
  process: {
    entry: true;
    input: { page: number };
    output: { totalProcessed: number };
    continueWith: { typeName: 'process' }; // Self-reference
  };
};

// In processor:
return complete(async ({ continueWith }) => {
  if (hasMorePages) {
    return continueWith({ typeName: "process", input: { page: page + 1 } });
  }
  return { totalProcessed: count }; // Terminal - return output instead
});
```

### Go-to

Jobs can jump to earlier or different types: `A -> B -> A -> B -> done`

```ts
type Definitions = {
  start: { entry: true; input: {...}; continueWith: { typeName: 'middle' } };
  middle: {
    input: {...};
    output: {...};
    continueWith: { typeName: 'start' | 'end' }; // Can go back to start
  };
  end: { input: {...}; output: {...} };
};
```

## Running the example

```bash
pnpm install
pnpm start
```

## Expected output

```
╔════════════════════════════════════════════════════════════╗
║                  QUEUERT FEATURES SHOWCASE                 ║
╚════════════════════════════════════════════════════════════╝
Starting PostgreSQL...

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

----------------------------------------
WORKFLOW COMPLETED
----------------------------------------
Order status: confirmed
Product stock: 3 (was 5, ordered 2)
Payment ID: pay_1234567890
Confirmed at: 2026-01-21T...

============================================================
CHAIN PATTERNS SHOWCASE: Subscription Lifecycle
============================================================

----------------------------------------
SCENARIO 1: User converts trial to paid
----------------------------------------

[create-subscription] Creating subscription for user user-123
  Created subscription #1

[activate-trial] Activating 7-day trial
  Trial activated until 2026-01-28T...

[trial-decision] Evaluating trial for subscription #1
  User decision: CONVERT to paid

[convert-to-paid] Converting subscription #1 to paid
  Subscription is now active!

[charge-billing] Processing cycle 1
  Charged $9.99 for cycle 1
  Total charged so far: $9.99
  Scheduling next billing cycle...

[charge-billing] Processing cycle 2
  Charged $9.99 for cycle 2
  Total charged so far: $19.98
  Scheduling next billing cycle...

[charge-billing] Processing cycle 3
  Charged $9.99 for cycle 3
  Total charged so far: $29.97
  Max cycles reached, cancelling subscription...

[cancel-subscription] Cancelling subscription #1
  Reason: max_billing_cycles_reached
  Subscription cancelled at 2026-01-21T...

----------------------------------------
SCENARIO 1 COMPLETED
----------------------------------------
Final status: cancelled
Billing cycles completed: 3
Total charged: $29.97
Cancelled at: 2026-01-21T...

----------------------------------------
SCENARIO 2: User lets trial expire
----------------------------------------

[create-subscription] Creating subscription for user user-456
  Created subscription #2

[activate-trial] Activating 7-day trial
  Trial activated until 2026-01-28T...

[trial-decision] Evaluating trial for subscription #2
  User decision: LET EXPIRE

[expire-trial] Trial expired for subscription #2
  Subscription expired at 2026-01-21T...

----------------------------------------
SCENARIO 2 COMPLETED
----------------------------------------
Final status: expired
Billing cycles completed: 0
Total charged: $0.00
Expired at: 2026-01-21T...

╔════════════════════════════════════════════════════════════╗
║                    ALL SHOWCASES COMPLETE                  ║
╚════════════════════════════════════════════════════════════╝

Cleanup complete!
```
