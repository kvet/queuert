---
title: Job Chain Patterns
description: Linear, branched, loop, and go-to patterns.
sidebar:
  order: 5
---

Chains support various execution patterns via `continueWith`:

## Linear

Jobs execute one after another: `create-subscription -> activate-trial`

```ts
const jobTypeRegistry = defineJobTypeRegistry<{
  'create-subscription': {
    entry: true;
    input: { userId: string; planId: string };
    continueWith: { typeName: 'activate-trial' };
  };
  'activate-trial': {
    input: { subscriptionId: number; trialDays: number };
    continueWith: { typeName: 'trial-decision' };
  };
}>();

// In processor
'create-subscription': {
  attemptHandler: async ({ job, complete }) => {
    return complete(async ({ sql, continueWith }) => {
      const [sub] = await sql`INSERT INTO subscriptions ... RETURNING id`;
      return continueWith({
        typeName: "activate-trial",
        input: { subscriptionId: sub.id, trialDays: 7 },
      });
    });
  },
},
```

## Branched

Jobs conditionally continue to different types: `trial-decision -> convert-to-paid | expire-trial`

```ts
'trial-decision': {
  input: { subscriptionId: number };
  continueWith: { typeName: 'convert-to-paid' | 'expire-trial' };  // Union type
};

// In processor - choose path based on condition
'trial-decision': {
  attemptHandler: async ({ job, complete }) => {
    const shouldConvert = userWantsToConvert;
    return complete(async ({ continueWith }) => {
      return continueWith({
        typeName: shouldConvert ? "convert-to-paid" : "expire-trial",
        input: { subscriptionId: job.input.subscriptionId },
      });
    });
  },
},
```

## Loops

Jobs continue to the same type: `charge-billing -> charge-billing -> ... -> done`

```ts
const jobTypeRegistry = defineJobTypeRegistry<{
  'charge-billing': {
    input: { subscriptionId: number; cycle: number };
    output: { finalCycle: number; totalCharged: number };  // Terminal output
    continueWith: { typeName: 'charge-billing' };  // Self-reference for looping
  };
}>();

// In processor - loop or terminate with output
'charge-billing': {
  attemptHandler: async ({ job, complete }) => {
    await chargePayment(job.input.subscriptionId);
    return complete(async ({ continueWith }) => {
      if (job.input.cycle < MAX_CYCLES) {
        return continueWith({
          typeName: "charge-billing",
          input: { subscriptionId: job.input.subscriptionId, cycle: job.input.cycle + 1 },
        });
      }
      return { finalCycle: job.input.cycle, totalCharged: calculateTotal() };
    });
  },
},
```

## Go-to

Jobs jump to a different type mid-chain: `charge-billing -> cancel-subscription`

```ts
const jobTypeRegistry = defineJobTypeRegistry<{
  'charge-billing': {
    input: { subscriptionId: number; cycle: number };
    output: { finalCycle: number; totalCharged: number };
    continueWith: { typeName: 'charge-billing' | 'cancel-subscription' };  // Loop or jump
  };
  'cancel-subscription': {
    input: { subscriptionId: number; reason: string };
    output: { cancelledAt: string };
  };
}>();

// In processor - jump to cancel when max cycles reached
'charge-billing': {
  attemptHandler: async ({ job, complete }) => {
    return complete(async ({ continueWith }) => {
      if (job.input.cycle >= MAX_CYCLES) {
        return continueWith({
          typeName: "cancel-subscription",
          input: { subscriptionId: job.input.subscriptionId, reason: "max_billing_cycles_reached" },
        });
      }
      return continueWith({
        typeName: "charge-billing",
        input: { subscriptionId: job.input.subscriptionId, cycle: job.input.cycle + 1 },
      });
    });
  },
},
```

## Continuation References

All examples above use **nominal references** — `{ typeName: "..." }`. Queuert also supports **structural references** (`{ input: {...} }`) that match any job type with a compatible input shape, enabling loose coupling. See [Job Type References](/queuert/advanced/job-type-references/) for details and examples.

See [examples/showcase-chain-patterns](https://github.com/kvet/queuert/tree/main/examples/showcase-chain-patterns) for a complete working example demonstrating all four patterns through a subscription lifecycle workflow. See also [Job Blockers](../job-blockers/) for parallel dependencies and [Job Chain Model](/queuert/advanced/job-chain-model/) reference.
