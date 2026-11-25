---
title: Job type references
description: Job type definition patterns and type hierarchy.
sidebar:
  order: 6
---

A job type can reference other job types in two ways, by name or by input shape, and the two combine freely.

## Reference modes

### Nominal reference (by typeName)

A nominal reference names the job type, or a union of names:

```typescript
{
  typeName: "step2" | "step2_alt";
}
```

### Structural reference (by input)

A structural reference names an input shape and matches every job type whose input matches it:

```typescript
{ input: { b: boolean } | { c: string } }
```

When several job types match, the caller picks one at runtime.

## Application

### Continuation (`continueWith`)

`continueWith` lists the job types a job can continue to, using either mode or a union of both:

```typescript
continueWith: { typeName: 'step2' | 'step2_alt' } | { input: { c: boolean } }
```

Structural references loosen the coupling: a router does not need to know every handler by name.

```ts
const jobTypes = defineJobTypes<{
  router: {
    entry: true;
    input: { path: string };
    continueWith: { input: { payload: string } };
  };
  "handler-a": {
    input: { payload: string };
    output: { resultA: string };
  };
  "handler-b": {
    input: { payload: string };
    output: { resultB: number };
  };
}>();
```

### Blockers

`blockers` lists the job types that must complete before the job runs. It is an ordered array with two kinds of slot.

A fixed slot takes exactly one blocker matching the reference:

```typescript
blockers: [{ typeName: "auth" }, { typeName: "validate" }];
```

A rest slot takes zero or more blockers matching the reference:

```typescript
blockers: [
  { typeName: 'auth' },
  ...{ typeName: 'validator' }[]
]
```

With a structural reference, any entry job type with a matching input shape fills the slot. Here `aggregate` accepts any number of blockers whose input has `{ url: string }`, so both `fetch-a` and `fetch-b` qualify:

```ts
const jobTypes = defineJobTypes<{
  "fetch-a": {
    entry: true;
    input: { url: string };
    output: { data: string };
  };
  "fetch-b": {
    entry: true;
    input: { url: string };
    output: { data: string };
  };
  aggregate: {
    entry: true;
    input: null;
    output: { combined: string[] };
    blockers: [...{ input: { url: string } }[]];
  };
}>();
```

### Blocker output typing

`job.blockers` outputs are typed from the reference: a nominal reference gives the output type of the named job types, a structural one the union of the output types of every match. Below, `auth.output` is `{ userId: string }` and `validate.output` is `{ valid: boolean }`:

```ts
const jobTypes = defineJobTypes<{
  auth: {
    entry: true;
    input: { token: string };
    output: { userId: string };
  };
  validate: {
    entry: true;
    input: { data: unknown };
    output: { valid: boolean };
  };
  process: {
    entry: true;
    input: { action: string };
    output: { done: boolean };
    blockers: [{ typeName: "auth" }, { typeName: "validate" }];
  };
}>();

const processors = createProcessors({
  client,
  jobTypes,
  processors: {
    process: {
      attemptHandler: async ({ job, applyJobOutcome }) => {
        const [auth, validate] = job.blockers;
        await withTxHooks(async (txHooks) =>
          db.transaction(async (tx) =>
            applyJobOutcome({
              tx,
              txHooks,
              output: { done: auth.output.userId !== "" && validate.output.valid },
            }),
          ),
        );
      },
    },
  },
});
```

## Structural matching semantics

`{ input: Type }` finds every job type whose input matches. Several implementations can share an input contract, and the caller chooses the implementation when it calls `continueWith`.

## Validation

With `defineJobTypes`, references are checked at compile time only; with `createJobTypes` they are also validated at runtime, and an invalid reference throws `JobTypeValidationError` ([Validation](/queuert/integrations/validation/)).

Continuation patterns are in [Chain patterns](/queuert/guides/chain-patterns/) and fan-out and fan-in in [Job blockers](/queuert/guides/job-blockers/); [Chain model](../chain-model/) covers the chain structure.
