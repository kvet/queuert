---
title: Runtime Validation
description: Add runtime validation with Zod, Valibot, TypeBox, or ArkType.
sidebar:
  order: 20
---

`defineJobTypes` gives you compile-time type safety with zero runtime cost. When job inputs come from outside your program — HTTP handlers, dashboards, cross-service cron payloads — TypeScript can't reject a malformed value before your handler runs. `createJobTypes` closes that gap: it accepts callbacks that run at every boundary the library touches (entry, input, output, continuation, blockers).

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

const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
```

Handlers keep full type inference — `job.input` is typed from the Zod schema. Copy the adapter from [examples/validation-zod](https://github.com/kvet/queuert/tree/main/examples/validation-zod) or pick another library from the integration page.

## Values that aren't JSON

Job inputs and outputs are stored as JSON, so a `Date`, `Map` or `bigint` needs a codec adapter that converts it to a stored form on every write and back on every read; the [Validation](/queuert/integrations/validation/#runtime-form-vs-stored-form) page covers how the two forms relate. A Zod codec does that in one schema:

```ts
const zDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (iso) => new Date(iso),
  encode: (date) => date.toISOString(),
});

const jobTypes = createZodCodecJobTypes({
  "send-reminder": {
    entry: true,
    input: z.object({ sendAt: zDate }), // Date in the handler, string in the database
    output: z.object({ sent: z.boolean() }),
  },
});
```

See [examples/codec-zod](https://github.com/kvet/queuert/tree/main/examples/codec-zod) for the full chain.

When you'd rather not write a codec per type, one codec can serve every job type. [examples/codec-superjson](https://github.com/kvet/queuert/tree/main/examples/codec-superjson) declares job types as plain TypeScript types holding a `Date`, `Map` or `bigint` and stores each value as superjson's `{ json, meta }` envelope:

```ts
const jobTypes = createSuperjsonJobTypes<{
  "send-reminder": { entry: true; input: { sendAt: Date }; output: { sent: boolean } };
}>({ "send-reminder": true });
```

## How errors surface

A failed validation throws `JobTypeValidationError`. A `code` identifies which boundary rejected the value, and `typeName` identifies the job type:

```ts
import { JobTypeValidationError, withTxHooks } from "queuert";

try {
  await withTxHooks(async (txHooks) =>
    stateProvider.withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, txHooks, typeName: "send-email", input: untrusted }),
    ),
  );
} catch (err) {
  if (err instanceof JobTypeValidationError && err.code === "invalid_input") {
    // 400 to the caller — the payload was malformed
  }
}
```

Errors thrown by the underlying schema library (`ZodError`, `ValiError`, `TypeBoxError`, ...) are caught and wrapped, so callers always handle a single error type regardless of which library the adapter uses. The five codes are `not_entry_point`, `invalid_input`, `invalid_output`, `invalid_continuation`, and `invalid_blockers`. `details` holds what failed validation (the input, output, continuation target or blockers), and `cause` the error the validation function threw. When an encoder returns a value that is not JSON-serializable, `details` holds that encoded value and the `path` to the offending part, such as `["items", 1, "at"]`.

## See also

- [Validation Adapters](/queuert/integrations/validation/) — the adapter pattern, the runtime-vs-stored split, and ready-to-copy adapters for Zod, Valibot, TypeBox, and ArkType
- [Custom Validation Adapter](/queuert/integrations/validation/custom/) — building and conformance-testing your own validation adapter
- [Error Handling](/queuert/guides/error-handling/) — how `JobTypeValidationError` interacts with retries and chain failure
