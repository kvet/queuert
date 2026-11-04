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

The two forms are bridged by an encoder and a decoder for each of `input` and `output`:

- `encodeInput` / `encodeOutput` run on every write, turning the runtime form into the stored form.
- `decodeInput` / `decodeOutput` run on every read, turning the stored form back into the runtime form.

For most schemas the two forms are identical and both methods are a validation pass that returns the value unchanged. They diverge when a schema transforms — a `Date` in the handler stored as an ISO string, for instance. See [`examples/codec-zod`](https://github.com/kvet/queuert/tree/main/examples/codec-zod) for a per-type codec, and [`examples/codec-superjson`](https://github.com/kvet/queuert/tree/main/examples/codec-superjson) for one codec shared by every job type.

Whatever an encoder returns is checked against `isJsonSerializable` by `createJobTypes` itself, so an adapter that accidentally lets a `Date` reach storage fails loudly on the first write rather than corrupting the row.

## `defineJobTypes` vs `createJobTypes`

`defineJobTypes` is a lightweight type-only helper. It provides compile-time type inference with zero runtime cost — no validation functions are executed. Use it when your inputs come from trusted internal code.

`defineJobTypes` constrains `input` and `output` to JSON-serializable types at compile time. Since there is no codec, the runtime form _is_ the stored form, so a definition carrying a `Date`, `Map`, or `bigint` is a type error that points you at a validator adapter.

`createJobTypes` adds runtime validation and codecs on top of compile-time types. It accepts functions for entry checks, encoding and decoding, continuation validation, and blocker validation. Use it when your job inputs originate from external sources (APIs, webhooks, user input) where compile-time guarantees alone are insufficient, or when the runtime form is not directly storable.

## `JobTypes` Interface

The `JobTypes` object validates at each boundary:

| Job Type Definition        | Method                          | Purpose                                         |
| -------------------------- | ------------------------------- | ----------------------------------------------- |
| _(all)_                    | `getTypeNames`                  | Returns known type names (for merge/routing)    |
| `entry?: boolean`          | `validateEntry`                 | Validates job type can start a chain            |
| `input: unknown`           | `encodeInput` / `decodeInput`   | Converts input between runtime and stored form  |
| `output?: unknown`         | `encodeOutput` / `decodeOutput` | Converts output between runtime and stored form |
| `continueWith?: Reference` | `validateContinueWith`          | Validates continuation target                   |
| `blockers?: Reference[]`   | `validateBlockers`              | Validates blocker references                    |

### Codec Calls

Each codec method takes the `typeName` and the value. An adapter whose schemas only validate passes one function as both the encoder and the decoder of a field:

```ts
const parseInput = (typeName: string, input: unknown) => schemas[typeName].input.parse(input);
const parseOutput = (typeName: string, output: unknown) => schemas[typeName].output.parse(output);

encodeInput: parseInput,
decodeInput: parseInput,
encodeOutput: parseOutput,
decodeOutput: parseOutput,
```

The encoders are the gate: they run on every write, and a value they reject never reaches the database. The decoders run on every read and only for type names the registry lists in `getTypeNames`. When a decoder throws, the read that needed the value fails with `JobTypeValidationError`.

:::caution
Keep a job type, and a decoder that accepts every stored shape of it, for as long as rows of that type remain in the database. A row whose job type the registry no longer lists is read in its stored form, so its `input` and `output` no longer match the declared types; a decoder that rejects an older stored shape makes every read of that row — including a dashboard page listing it — fail. Delete the chains of a job type before removing it, and change a schema in a way that still decodes rows written under the previous one.

## Error Handling

All validation errors throw `JobTypeValidationError` with:

- `code`: Error type (`'invalid_input'`, `'invalid_output'`, `'invalid_continuation'`, `'invalid_blockers'`, `'not_entry_point'`)
- `typeName`: The job type that failed validation
- `message`: Human-readable error message
- `details`: Additional context — the rejected value under `input` or `output`, the offending `path` for a value that is not JSON-serializable, or the rejected `target` / `blockers`

:::note
Errors thrown by the underlying schema library are caught by `createJobTypes` and wrapped in
`JobTypeValidationError` with the appropriate error code, so consumers always handle a single
error type regardless of which validation library is used.
:::

## Example Adapters

Complete adapter implementations for each library:

- [Zod](https://github.com/kvet/queuert/tree/main/examples/validation-zod)
- [Valibot](https://github.com/kvet/queuert/tree/main/examples/validation-valibot)
- [TypeBox](https://github.com/kvet/queuert/tree/main/examples/validation-typebox)
- [ArkType](https://github.com/kvet/queuert/tree/main/examples/validation-arktype)
- [Zod with codecs](https://github.com/kvet/queuert/tree/main/examples/codec-zod) — runtime form differs from stored form
- [superjson](https://github.com/kvet/queuert/tree/main/examples/codec-superjson) — one codec for every job type, no per-type schema

## Conformance Testing

Custom validation adapters can be validated against Queuert's conformance suite via `runValidationAdapterConformance` from `queuert/conformance`. The suite combines runtime checks (the method contract, error wrapping, both codec directions) with type-level checks (schema-to-shape inference) — the fixture's builder return types enforce the type contract at the call site, so inference bugs surface as compile errors before the runtime suite runs. See [Custom Adapters](/queuert/advanced/custom-adapters/) for the full pattern.

## See Also

- [Runtime Validation Guide](/queuert/guides/runtime-validation/) — When to use runtime validation
- [Chain Patterns](/queuert/guides/chain-patterns/) — Continuation references and patterns
- [Custom Adapters](/queuert/advanced/custom-adapters/) — Building and validating a custom validation adapter
- [Conformance Reference](/queuert/api/conformance/readme/) — Runner API and fixture types
