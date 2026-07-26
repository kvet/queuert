---
title: Validation Adapters
description: Schema-agnostic runtime validation with Zod, Valibot, TypeBox, or ArkType.
sidebar:
  order: 3
---

Queuert's runtime validation follows an adapter pattern. The core provides `createJobTypes`, which accepts raw validation and codec functions. Schema-specific adapters (Zod, Valibot, TypeBox, ArkType) are implemented in user-land, wrapping their respective schema libraries into the `JobTypes` interface.

Each adapter:

1. Accepts schema definitions in the library's native format
2. Infers `TJobTypeDefinitions` from the schemas (providing the same compile-time safety as `defineJobTypes`)
3. Calls `createJobTypes` with functions that delegate to the schema library

## Runtime Form vs Stored Form

A job type definition's `input` and `output` describe the **runtime** form — what a handler receives and what a client read returns. The **stored** form is what the state adapter persists, and it must be JSON-serializable.

The two forms are bridged by `encode` and `decode`:

- `encode` runs on every write, turning the runtime form into the stored form.
- `decode` runs on every read, turning the stored form back into the runtime form.

For most schemas the two forms are identical and both methods are a validation pass that returns the value unchanged. They diverge when a schema transforms — a `Date` in the handler stored as an ISO string, for instance. See [`examples/codec-zod`](https://github.com/kvet/queuert/tree/main/examples/codec-zod) for that case.

Whatever `encode` returns is checked against `isJsonSerializable` by `createJobTypes` itself, so an adapter that accidentally lets a `Date` reach storage fails loudly on the first write rather than corrupting the row.

## `defineJobTypes` vs `createJobTypes`

`defineJobTypes` is a lightweight type-only helper. It provides compile-time type inference with zero runtime cost — no validation functions are executed. Use it when your inputs come from trusted internal code.

`defineJobTypes` constrains `input` and `output` to JSON-serializable types at compile time. Since there is no codec, the runtime form _is_ the stored form, so a definition carrying a `Date`, `Map`, or `bigint` is a type error that points you at a validator adapter.

`createJobTypes` adds runtime validation and codecs on top of compile-time types. It accepts functions for entry checks, encoding and decoding, continuation validation, and blocker validation. Use it when your job inputs originate from external sources (APIs, webhooks, user input) where compile-time guarantees alone are insufficient, or when the runtime form is not directly storable.

## `JobTypes` Interface

The `JobTypes` object validates at each boundary:

| Job Type Definition        | Method                 | Purpose                                         |
| -------------------------- | ---------------------- | ----------------------------------------------- |
| _(all)_                    | `getTypeNames`         | Returns known type names (for merge/routing)    |
| `entry?: boolean`          | `validateEntry`        | Validates job type can start a chain            |
| `input: unknown`           | `encode` / `decode`    | Converts input between runtime and stored form  |
| `output?: unknown`         | `encode` / `decode`    | Converts output between runtime and stored form |
| `continueWith?: Reference` | `validateContinueWith` | Validates continuation target                   |
| `blockers?: Reference[]`   | `validateBlockers`     | Validates blocker references                    |

### Batch Codec Calls

`encode` and `decode` are async and take a **batch**. Each item carries the `typeName` and a `direction` of `"input"` or `"output"`, and a single call can mix both:

```ts
encode: async (items) =>
  items.map((item) => {
    const schema = item.direction === "input"
      ? schemas[item.typeName].input
      : schemas[item.typeName].output;
    return schema.parse(item.value);
  }),
```

Core batches deliberately: creating N chains issues one `encode` call, and listing a page of jobs issues one `decode` call covering every input _and_ every output on the page. Adapters that talk to a network service — an encryption or tokenization backend, say — can amortize that into a single round trip. Adapters that only validate pay a per-item `direction` check and nothing else.

## Error Handling

All validation errors throw `JobTypeValidationError` with:

- `code`: Error type (`'invalid_input'`, `'invalid_output'`, `'invalid_continuation'`, `'invalid_blockers'`, `'not_entry_point'`)
- `typeName`: The job type that failed validation
- `message`: Human-readable error message
- `details`: Additional context (original error, input value, etc.)

:::note
Errors thrown by the underlying schema library are caught by `createJobTypes` and wrapped in
`JobTypeValidationError` with the appropriate error code, so consumers always handle a single
error type regardless of which validation library is used.
:::

## Migrating from `parseInput` / `parseOutput`

Earlier versions exposed two synchronous, write-only methods. They are replaced by `encode` and `decode`, which run on writes and reads respectively.

An adapter that only validates ports mechanically. The old shape:

```ts
parseInput: (typeName, input) => schemas[typeName].input.parse(input),
parseOutput: (typeName, output) => schemas[typeName].output.parse(output),
```

becomes one pair of batch methods that pick the schema from each item's `direction`:

```ts
const schemaFor = (typeName: string, direction: "input" | "output") => {
  const schema = direction === "input"
    ? schemas[typeName].input
    : schemas[typeName].output;
  if (!schema) throw new Error(`Job type "${typeName}" has no ${direction} schema`);
  return schema;
};

encode: async (items) =>
  items.map((item) => schemaFor(item.typeName, item.direction).parse(item.value)),
decode: async (items) =>
  items.map((item) => schemaFor(item.typeName, item.direction).parse(item.value)),
```

Both directions run the same schema because the schema does not transform — the stored form and the runtime form are the same value. If your schemas _do_ transform, the two methods diverge and you need a real codec:

```ts
encode: async (items) =>
  items.map((item) => z.encode(schemaFor(item.typeName, item.direction), item.value)),
decode: async (items) =>
  items.map((item) => z.decode(schemaFor(item.typeName, item.direction), item.value)),
```

Two things to check while porting:

- **`parseInput` used to run on write only.** If a schema of yours transformed, handlers were previously receiving the _transformed_ value. They now receive what `decode` returns, which is the behaviour the transform implied all along.
- **The stored form is validated.** Whatever `encode` returns is checked with `isJsonSerializable`. A schema that passes a `Date` through untouched used to be persisted as a coerced string; it now throws `JobTypeValidationError` on the write.

## Example Adapters

Complete adapter implementations for each library:

- [Zod](https://github.com/kvet/queuert/tree/main/examples/validation-zod)
- [Valibot](https://github.com/kvet/queuert/tree/main/examples/validation-valibot)
- [TypeBox](https://github.com/kvet/queuert/tree/main/examples/validation-typebox)
- [ArkType](https://github.com/kvet/queuert/tree/main/examples/validation-arktype)
- [Zod with codecs](https://github.com/kvet/queuert/tree/main/examples/codec-zod) — runtime form differs from stored form

## Conformance Testing

Custom validation adapters can be validated against Queuert's conformance suite via `runValidationAdapterConformance` from `queuert/conformance`. The suite combines runtime checks (the method contract, error wrapping, both codec directions) with type-level checks (schema-to-shape inference) — the fixture's builder return types enforce the type contract at the call site, so inference bugs surface as compile errors before the runtime suite runs. See [Custom Adapters](/queuert/advanced/custom-adapters/) for the full pattern.

## See Also

- [Runtime Validation Guide](/queuert/guides/runtime-validation/) — When to use runtime validation
- [Chain Patterns](/queuert/guides/chain-patterns/) — Continuation references and patterns
- [Custom Adapters](/queuert/advanced/custom-adapters/) — Building and validating a custom validation adapter
- [Conformance Reference](/queuert/reference/queuert/conformance/) — Runner API and fixture types
