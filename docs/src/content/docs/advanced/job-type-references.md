---
title: Job Type References
description: Job type definition patterns and type hierarchy.
sidebar:
  order: 6
---

## Overview

This document describes the model for how job types reference each other. Instead of referencing other job types by name only, the system supports two reference modes that can be combined flexibly. See `JobTypeReference`, `NominalJobTypeReference`, and `StructuralJobTypeReference` TSDoc for type details.

## Reference Modes

### Nominal Reference (by typeName)

Explicitly reference job types by their name. Supports union of names for flexibility:

```typescript
{
  typeName: "step2" | "step2_alt";
}
```

### Structural Reference (by input)

Reference job types by their input type signature. This matches **all** job types whose input matches the given structure:

```typescript
{ input: { b: boolean } | { c: string } }
```

When multiple job types match, the user decides which one to use at runtime.

## Application

### Continuation (`continueWith`)

Defines what job types a job can continue to. References can use either mode or combine them with unions:

```typescript
continueWith: { typeName: 'step2' | 'step2_alt' } | { input: { c: boolean } }
```

Structural references enable loose coupling — a router doesn't need to know every handler by name:

```ts
const jobTypeRegistry = defineJobTypeRegistry<{
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

// continueWith accepts either "handler-a" or "handler-b" — both match the input shape
```

### Blockers

Defines job types that must complete before this job can run. Blockers are an ordered array supporting two slot types:

**Fixed slots**: Each position requires exactly one blocker matching the reference.

```typescript
blockers: [{ typeName: "auth" }, { typeName: "validate" }];
```

**Rest/variadic slots**: Zero or more blockers matching the reference.

```typescript
blockers: [
  { typeName: 'auth' },
  ...{ typeName: 'validator' }[]
]
```

Structural references allow any entry job type with a matching input shape to satisfy a blocker slot:

```ts
const jobTypeRegistry = defineJobTypeRegistry<{
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

// aggregate accepts any number of blockers whose input has { url: string }
// — both "fetch-a" and "fetch-b" qualify
```

### Blocker Output Typing

When accessing `job.blockers`, outputs are typed based on the reference:

- **Nominal reference**: Output type of the named job type(s)
- **Structural reference**: Union of output types from all matching job types

```ts
const jobTypeRegistry = defineJobTypeRegistry<{
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

const processorRegistry = createJobTypeProcessorRegistry(client, jobTypeRegistry, {
  process: {
    attemptHandler: async ({ job, complete }) => {
      const [auth, validate] = job.blockers;
      // auth.output is { userId: string }
      // validate.output is { valid: boolean }
      return complete(() => ({ done: auth.output.userId !== "" && validate.output.valid }));
    },
  },
});
```

## Structural Matching Semantics

When using `{ input: Type }`, the system finds all job types whose input matches that type. This enables abstraction — multiple implementations can share an input contract — and runtime flexibility — the caller chooses the specific implementation when calling `continueWith`.

## Validation

### Compile-Time (`defineJobTypeRegistry`)

Type-level validation only. References are checked at compile time via TypeScript's type system.

### Runtime (`createJobTypeRegistry`)

When using validation libraries (Zod, Valibot, etc.), references are validated at both compile time and runtime. Invalid references throw `JobTypeValidationError`.

## See Also

- [Chain Patterns](/queuert/guides/chain-patterns/) — Continuation patterns (linear, branched, loops, go-to)
- [Job Blockers](/queuert/guides/job-blockers/) — Fan-out/fan-in dependencies
- [Job Chain Model](../job-chain-model/) — Chain structure, Promise analogy
- [Job Processing](../job-processing/) — Prepare/complete pattern
