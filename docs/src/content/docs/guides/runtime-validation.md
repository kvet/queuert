---
title: Runtime Validation
description: Add runtime validation with Zod, Valibot, TypeBox, or ArkType.
sidebar:
  order: 4
---

For production APIs accepting external input, you can add runtime validation using any schema library (Zod, Valibot, TypeBox, etc.). The core is minimal -- schema-specific adapters are implemented in user-land.

Both `defineJobTypes` (compile-time only) and `createJobTypeRegistry` (runtime validation) provide the same compile-time type safety. Runtime validation adds protection against invalid external data.

See complete adapter examples: [Zod](https://github.com/kvet/queuert/tree/main/examples/validation-zod), [Valibot](https://github.com/kvet/queuert/tree/main/examples/validation-valibot), [TypeBox](https://github.com/kvet/queuert/tree/main/examples/validation-typebox), [ArkType](https://github.com/kvet/queuert/tree/main/examples/validation-arktype).

## The Validation Adapter Pattern

Queuert's runtime validation follows an adapter pattern. The core provides `createJobTypeRegistry`, which accepts raw validation functions. Schema-specific adapters (Zod, Valibot, TypeBox, ArkType) are implemented in user-land, wrapping their respective schema libraries into the registry interface.

Each adapter:

1. Accepts schema definitions in the library's native format
2. Infers `TJobTypeDefinitions` from the schemas (providing the same compile-time safety as `defineJobTypes`)
3. Calls `createJobTypeRegistry` with validation functions that delegate to the schema library

### `defineJobTypes` vs `createJobTypeRegistry`

`defineJobTypes` is a lightweight type-only helper. It provides compile-time type inference with zero runtime cost -- no validation functions are executed. Use it when your inputs come from trusted internal code.

`createJobTypeRegistry` adds runtime validation on top of compile-time types. It accepts validation functions for entry checks, input/output parsing, continuation validation, and blocker validation. Use it when your job inputs originate from external sources (APIs, webhooks, user input) where compile-time guarantees alone are insufficient.

### Registry Interface

The registry validates at each boundary:

| Job Type Definition        | Registry Method        | Purpose                                      |
| -------------------------- | ---------------------- | -------------------------------------------- |
| _(all)_                    | `getTypeNames`         | Returns known type names (for merge/routing) |
| `entry?: boolean`          | `validateEntry`        | Validates job type can start a chain         |
| `input: unknown`           | `parseInput`           | Parses and validates job input               |
| `output?: unknown`         | `parseOutput`          | Parses and validates job output              |
| `continueWith?: Reference` | `validateContinueWith` | Validates continuation target                |
| `blockers?: Reference[]`   | `validateBlockers`     | Validates blocker references                 |

### Error Handling

All validation errors throw `JobTypeValidationError` with:

- `code`: Error type (`'invalid_input'`, `'invalid_output'`, `'invalid_continuation'`, `'invalid_blockers'`, `'not_entry_point'`)
- `typeName`: The job type that failed validation
- `message`: Human-readable error message
- `details`: Additional context (original error, input value, etc.)
