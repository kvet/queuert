# Runtime Job Validation

## Overview

This document describes the runtime validation system for job types. While `defineJobTypes` provides compile-time type safety, `createJobTypeRegistry` enables runtime validation using schema validation libraries like Zod, Valibot, TypeBox, or others.

## JobTypeRegistry Interface

```typescript
interface JobTypeRegistry<TJobTypeDefinitions = unknown> {
  validateEntry: (typeName: string) => void;
  parseInput: (typeName: string, input: unknown) => unknown;
  parseOutput: (typeName: string, output: unknown) => unknown;
  validateContinueWith: (typeName: string, to: { typeName: string; input: unknown }) => void;
  validateBlockers: (
    typeName: string,
    blockers: readonly { typeName: string; input: unknown }[],
  ) => void;
  readonly $definitions: TJobTypeDefinitions;
}
```

### Method Mapping

| BaseJobTypeDefinition             | Registry Method                          | Purpose                              |
| --------------------------------- | ---------------------------------------- | ------------------------------------ |
| `entry?: boolean`                 | `validateEntry(typeName)`                | Validates job type can start a chain |
| `input: unknown`                  | `parseInput(typeName, input)`            | Parses and validates job input       |
| `output?: unknown`                | `parseOutput(typeName, output)`          | Parses and validates job output      |
| `continueWith?: JobTypeReference` | `validateContinueWith(typeName, target)` | Validates continuation target        |
| `blockers?: JobTypeReference[]`   | `validateBlockers(typeName, blockers)`   | Validates blocker references         |

## Creating a Registry

The core `createJobTypeRegistry` accepts validation functions directly:

```typescript
const registry = createJobTypeRegistry<TJobTypeDefinitions>({
  validateEntry: (typeName: string): void => void,
  parseInput: (typeName: string, input: unknown) => unknown,
  parseOutput: (typeName: string, output: unknown) => unknown,
  validateContinueWith: (typeName: string, to: { typeName: string; input: unknown }) => void,
  validateBlockers: (typeName: string, blockers: readonly { typeName: string; input: unknown }[]) => void,
});
```

Validation functions should throw `JobTypeValidationError` on failure. The core provides this error type; user-land adapters translate schema-specific errors into it.

### Reference Validation

For `validateContinueWith` and `validateBlockers`, the validation receives objects with both `typeName` and `input`:

```typescript
validateContinueWith("step1", { typeName: "step2", input: { b: true } });
validateBlockers("main", [{ typeName: "auth", input: { token: "abc" } }]);
```

Validation can check either the `typeName` (nominal) or `input` (structural) part, depending on how the job type's references are defined.

## User-Land Adapters

Schema-specific adapters are implemented outside of core queuert. Each adapter:

1. Accepts schema definitions in the library's native format
2. Infers `TJobTypeDefinitions` from the schemas
3. Calls `createJobTypeRegistry` with validation functions that delegate to the schema library

The core catches any errors thrown by validation functions and wraps them in `JobTypeValidationError`.

### Example: Zod Adapter

```typescript
import { z } from "zod";
import { createJobTypeRegistry } from "queuert";

type ZodJobTypeSchema = {
  entry?: boolean;
  input: z.ZodType;
  output?: z.ZodType;
  continueWith?: z.ZodType;
  blockers?: z.ZodType;
};

const createZodJobTypeRegistry = <T extends Record<string, ZodJobTypeSchema>>(schemas: T) => {
  const getSchema = (typeName: string) => {
    const schema = schemas[typeName];
    if (!schema) throw new Error(`Unknown job type: ${typeName}`);
    return schema;
  };

  return createJobTypeRegistry<InferZodJobTypes<T>>({
    validateEntry: (typeName) => {
      if (!getSchema(typeName).entry) throw new Error("Not an entry point");
    },
    parseInput: (typeName, input) => getSchema(typeName).input.parse(input),
    parseOutput: (typeName, output) => getSchema(typeName).output?.parse(output) ?? output,
    validateContinueWith: (typeName, to) => getSchema(typeName).continueWith?.parse(to),
    validateBlockers: (typeName, blockers) => getSchema(typeName).blockers?.parse(blockers),
  });
};
```

The core catches any errors thrown by these functions and wraps them in `JobTypeValidationError` with the appropriate error code.

### Usage

```typescript
const registry = createZodJobTypeRegistry({
  blocker: {
    entry: true,
    input: z.object({ token: z.string() }),
    output: z.object({ userId: z.string() }),
  },
  main: {
    entry: true,
    input: z.object({ data: z.string() }),
    continueWith: z.object({ typeName: z.literal("next") }),
    blockers: z.tuple([z.object({ typeName: z.literal("blocker") })]),
  },
  next: {
    input: z.object({ processed: z.boolean() }),
    output: z.object({ done: z.boolean() }),
  },
});
```

### Other Libraries

The same pattern applies to Valibot or any validation library:

```typescript
// Valibot adapter
const createValibotJobTypeRegistry = <T extends Record<string, ValibotJobTypeSchema>>(
  schemas: T,
) => {
  const getSchema = (typeName: string) => {
    const schema = schemas[typeName];
    if (!schema) throw new Error(`Unknown job type: ${typeName}`);
    return schema;
  };

  return createJobTypeRegistry<InferValibotJobTypes<T>>({
    validateEntry: (typeName) => {
      if (!getSchema(typeName).entry) throw new Error("Not an entry point");
    },
    parseInput: (typeName, input) => v.parse(getSchema(typeName).input, input),
    parseOutput: (typeName, output) => v.parse(getSchema(typeName).output, output),
    // ... other methods
  });
};
```

## Error Handling

All validation errors throw `JobTypeValidationError` with:

- `code`: Error type (`'invalid_input'`, `'invalid_output'`, `'invalid_continuation'`, `'invalid_blockers'`, `'not_entry_point'`)
- `typeName`: The job type that failed validation
- `message`: Human-readable error message
- `details`: Additional context (original error, input value, etc.)
