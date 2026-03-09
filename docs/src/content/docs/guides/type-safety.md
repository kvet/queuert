---
title: Type Safety
description: End-to-end TypeScript inference for your job chains.
sidebar:
  order: 3
---

Queuert provides end-to-end type safety with full type inference. Define your job types once, and TypeScript ensures correctness throughout your entire codebase:

- **Job inputs and outputs** are inferred and validated at compile time
- **Continuations** are type-checked — `continueWith` only accepts valid target job types with matching inputs
- **Blockers** are fully typed — access `job.blockers` with correct output types for each blocker
- **Internal job types** without `entry: true` cannot be started directly via `startJobChain`

```ts
const jobTypeRegistry = defineJobTypeRegistry<{
  "fetch-data": {
    entry: true;
    input: { url: string };
    continueWith: { typeName: "process-data" };
  };
  "process-data": {
    input: { rawData: string };
    output: { result: number };
  };
}>();

// TypeScript enforces:
// - startJobChain only accepts "fetch-data" (has entry: true)
// - continueWith only accepts { typeName: "process-data", input: { rawData: string } }
// - job.input is typed per job type in processors
// - complete() return type must match the output type
```

For runtime validation with libraries like Zod, Valibot, or ArkType, see [Runtime Validation](../runtime-validation/).

No runtime type errors. No mismatched job names. Your workflow logic is verified before your code ever runs.
