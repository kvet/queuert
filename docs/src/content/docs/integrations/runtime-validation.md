---
title: Runtime Validation
description: Schema-agnostic runtime validation with Zod, Valibot, TypeBox, or ArkType.
sidebar:
  order: 3
---

Queuert's runtime validation follows an adapter pattern. The core provides `createJobTypes`, which accepts raw validation functions. Schema-specific adapters (Zod, Valibot, TypeBox, ArkType) are implemented in user-land, wrapping their respective schema libraries into the `JobTypes` interface.

Each adapter:

1. Accepts schema definitions in the library's native format
2. Infers `TJobTypeDefinitions` from the schemas (providing the same compile-time safety as `defineJobTypes`)
3. Calls `createJobTypes` with validation functions that delegate to the schema library

## `defineJobTypes` vs `createJobTypes`

`defineJobTypes` is a lightweight type-only helper. It provides compile-time type inference with zero runtime cost — no validation functions are executed. Use it when your inputs come from trusted internal code.

`createJobTypes` adds runtime validation on top of compile-time types. It accepts validation functions for entry checks, input/output parsing, continuation validation, and blocker validation. Use it when your job inputs originate from external sources (APIs, webhooks, user input) where compile-time guarantees alone are insufficient.

## `JobTypes` Interface

The `JobTypes` object validates at each boundary:

| Job Type Definition        | Method                 | Purpose                                      |
| -------------------------- | ---------------------- | -------------------------------------------- |
| _(all)_                    | `getTypeNames`         | Returns known type names (for merge/routing) |
| `entry?: boolean`          | `validateEntry`        | Validates job type can start a chain         |
| `input: unknown`           | `parseInput`           | Parses and validates job input               |
| `output?: unknown`         | `parseOutput`          | Parses and validates job output              |
| `continueWith?: Reference` | `validateContinueWith` | Validates continuation target                |
| `blockers?: Reference[]`   | `validateBlockers`     | Validates blocker references                 |

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

## Example Adapters

Complete adapter implementations for each library:

- [Zod](https://github.com/kvet/queuert/tree/main/examples/validation-zod)
- [Valibot](https://github.com/kvet/queuert/tree/main/examples/validation-valibot)
- [TypeBox](https://github.com/kvet/queuert/tree/main/examples/validation-typebox)
- [ArkType](https://github.com/kvet/queuert/tree/main/examples/validation-arktype)

## Conformance Testing

Custom validation adapters can be validated against Queuert's conformance suite via `runValidationAdapterConformance` from `queuert/conformance`. The suite combines runtime checks (six-method contract, error wrapping) with type-level checks (schema-to-shape inference) — the fixture's builder return types enforce the type contract at the call site, so inference bugs surface as compile errors before the runtime suite runs. See [Custom Adapters](/queuert/advanced/custom-adapters/) for the full pattern.

## See Also

- [Runtime Validation Guide](/queuert/guides/runtime-validation/) — When to use runtime validation
- [Chain Patterns](/queuert/guides/chain-patterns/) — Continuation references and patterns
- [Custom Adapters](/queuert/advanced/custom-adapters/) — Building and validating a custom validation adapter
- [Conformance Reference](/queuert/reference/queuert/conformance/) — Runner API and fixture types
