---
title: Runtime Validation
description: Add runtime validation with Zod, Valibot, TypeBox, or ArkType.
sidebar:
  order: 15
---

`defineJobTypes` gives you compile-time type safety with zero runtime cost. When job inputs come from outside your program — HTTP handlers, dashboards, cross-service cron payloads — TypeScript can't reject a malformed value before your handler runs. `createJobTypes` closes that gap: it accepts validation callbacks that run at every boundary the library touches (entry, input, output, continuation, blockers).

## When to use it

Reach for `createJobTypes` when inputs cross a trust boundary, or when you already depend on a schema library (Zod, Valibot, TypeBox, ArkType) and want the same schemas to guard your jobs. Stick with `defineJobTypes` when every caller is internal code TypeScript already checks.

## Usage

You typically don't call `createJobTypes` directly — you go through a thin schema-library adapter that infers `TJobTypeDefinitions` from your schemas and wires them into the validation callbacks. The Zod version looks like this:

```ts
import { createClient } from "queuert";
import { z } from "zod";

import { createZodJobTypes } from "./zod-adapter.js";

const jobTypes = createZodJobTypes({
  "send-email": {
    entry: true,
    input: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
    output: z.object({ messageId: z.string() }),
  },
});

const client = await createClient({ stateAdapter, notifyAdapter, jobTypes });
```

Handlers keep full type inference — `job.input` is typed from the Zod schema. The adapter itself is ~60 lines; copy it from [examples/validation-zod](https://github.com/kvet/queuert/tree/main/examples/validation-zod) or pick another library from the integration page.

## How errors surface

A failed validation throws `JobTypeValidationError`. A `code` identifies which boundary rejected the value, and `typeName` identifies the job type:

```ts
import { JobTypeValidationError } from "queuert";

try {
  await stateAdapter.withTransaction((ctx) =>
    client.startJobChain({ ...ctx, transactionHooks, typeName: "send-email", input: untrusted }),
  );
} catch (err) {
  if (err instanceof JobTypeValidationError && err.code === "invalid_input") {
    // 400 to the caller — the payload was malformed
  }
}
```

Errors thrown by the underlying schema library (`ZodError`, `ValiError`, `TypeBoxError`, ...) are caught and wrapped, so callers always handle a single error type regardless of which library the adapter uses. The five codes are `not_entry_point`, `invalid_input`, `invalid_output`, `invalid_continuation`, and `invalid_blockers`.

## See also

- [Runtime Validation Integration](/queuert/integrations/runtime-validation/) — the adapter pattern, the six-method contract, and ready-to-copy adapters for Zod, Valibot, TypeBox, and ArkType
- [Custom Adapters](/queuert/advanced/custom-adapters/) — building and conformance-testing your own validation adapter
- [Error Handling](/queuert/guides/error-handling/) — how `JobTypeValidationError` interacts with retries and chain failure
