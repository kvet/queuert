# Job Type Reference Model

## Overview

This document describes a new model for how job types reference each other. Instead of referencing other job types by name only, the system supports two reference modes that can be combined flexibly.

## Reference Modes

### Nominal Reference (by typeName)

Explicitly reference job types by their name:

```typescript
{ typeName: 'step2' }
```

Supports union of names for flexibility:

```typescript
{ typeName: 'step2' | 'step2_alt' }
```

### Structural Reference (by input)

Reference job types by their input type signature:

```typescript
{ input: { b: boolean } }
```

Supports union of input types:

```typescript
{ input: { b: boolean } | { c: string } }
```

This matches **all** job types whose input type matches the given structure (or any type in the union). When multiple job types match, the user decides which one to use at runtime.

## Application

### Continuation (`continueWith`)

Defines what job types a job can continue to:

```typescript
{
  step1: {
    entry: true,
    input: { a: boolean },
    continueWith: { typeName: 'step2' }
  },
  step2: {
    input: { b: boolean },
    output: { c: boolean }
  }
}
```

Or by structural matching:

```typescript
{
  step1: {
    entry: true,
    input: { a: boolean },
    continueWith: { input: { b: boolean } }
  },
  step2: {
    input: { b: boolean },
    output: { c: boolean }
  }
}
```

References can be combined with unions:

```typescript
continueWith: { typeName: 'step2' | 'step2_alt' } | { input: { c: boolean } }
```

### Blockers

Defines job types that must complete before this job can run. Blockers are an ordered array where each element is a reference (or union of references):

```typescript
{
  auth: {
    entry: true,
    input: { token: string },
    output: { userId: string }
  },
  authAlt: {
    entry: true,
    input: { token: string },
    output: { userId: string }
  },
  perform: {
    entry: true,
    input: { action: string },
    output: { result: boolean }
  },
  main: {
    entry: true,
    input: { data: string },
    output: { done: boolean },
    blockers: [
      { typeName: 'auth' | 'authAlt' },
      { typeName: 'perform' } | { input: { action: string } }
    ]
  }
}
```

Blockers support two slot types:

**Fixed slots**: Each position requires exactly one blocker matching the reference.

```typescript
blockers: [
  { typeName: 'auth' },
  { typeName: 'validate' }
]
// Requires exactly 2 blockers: first must be 'auth', second must be 'validate'
```

**Rest/variadic slots**: Zero or more blockers matching the reference.

```typescript
blockers: [
  { typeName: 'auth' },
  ...{ typeName: 'validator' }[]
]
// Requires 1 'auth' blocker + 0-N 'validator' blockers
```

**Rest-only** (simple array syntax):

```typescript
blockers: { input: { data: unknown } }[]
// Requires 0-N blockers with matching input type
```

**Mixed**:

```typescript
blockers: [
  { typeName: 'auth' },
  { typeName: 'config' },
  ...{ typeName: 'processor' }[]
]
// Requires 'auth', then 'config', then 0-N 'processor' blockers
```

### Blocker Output Typing

When accessing `job.blockers`, outputs are typed based on the reference:

- **Nominal reference**: Output type of the named job type(s)
- **Structural reference**: Union of output types from all matching job types

In the common case (single job type match), this resolves to a specific type. In advanced cases with multiple matches, the type is a union.

## Output Behavior

### Output Only (Chain Termination)

A job with only `output` terminates the chain:

```typescript
{
  step1: {
    entry: true,
    input: { a: boolean },
    output: { b: boolean }
  }
}
```

### ContinueWith Only (Must Continue)

A job with only `continueWith` must continue to another job:

```typescript
{
  step1: {
    entry: true,
    input: { a: boolean },
    continueWith: { typeName: 'step2' }
  },
  step2: {
    input: { b: boolean },
    output: { c: boolean }
  }
}
```

### Both Output and ContinueWith (Optional Continuation)

A job with both can either terminate or continue:

```typescript
{
  step1: {
    entry: true,
    input: { a: boolean },
    output: { done: true },
    continueWith: { input: { b: boolean } }
  },
  step2: {
    input: { b: boolean },
    output: { c: boolean }
  }
}
```

The process function decides at runtime whether to complete with output or continue.

## Structural Matching Semantics

When using `{ input: Type }`, the system finds all job types whose input matches that type. This enables:

### Abstraction

Multiple implementations can share an input contract:

```typescript
{
  step1: {
    entry: true,
    input: { a: boolean },
    continueWith: { input: { b: boolean } }  // matches step2 OR step2_alt
  },
  step2: {
    input: { b: boolean },
    output: { c: boolean }
  },
  step2_alt: {
    input: { b: boolean },
    output: { c: boolean }
  }
}
```

### Runtime Flexibility

The caller chooses the specific implementation when calling `continueWith`:

```typescript
continueWith({ typeName: 'step2', input: { b: true } })
// or
continueWith({ typeName: 'step2_alt', input: { b: true } })
```

Both are valid because both match the `{ input: { b: boolean } }` reference.

## Future Considerations

A simplified shorthand syntax could be added later for common cases:

```typescript
// Shorthand (future)
continueWith: 'step2' | 'step3'
blockers: ['auth', ...'processor'[]]

// Expands to full syntax
continueWith: { typeName: 'step2' | 'step3' }
blockers: [{ typeName: 'auth' }, ...{ typeName: 'processor' }[]]

// Mixed shorthand and structural
continueWith: 'step2' | { input: { b: boolean } }
```

This would reduce verbosity for nominal-only references while keeping the full syntax available for structural matching.

## Validation

### Compile-Time (`defineJobTypes`)

Type-level validation only. References are checked at compile time via TypeScript's type system.

### Runtime (`createJobTypeRegistry`)

When using validation libraries (Zod, Valibot, etc.), references are validated at both compile time and runtime. Invalid references throw `JobTypeValidationError`.

## Examples

### Single Job Chain

```typescript
defineJobTypes<{
  process: {
    entry: true;
    input: { data: string };
    output: { result: number };
  };
}>();
```

### Linear Chain

```typescript
defineJobTypes<{
  step1: {
    entry: true;
    input: { a: boolean };
    continueWith: { typeName: 'step2' };
  };
  step2: {
    input: { b: boolean };
    output: { c: boolean };
  };
}>();
```

### Branching by Name

```typescript
defineJobTypes<{
  router: {
    entry: true;
    input: { path: string };
    continueWith: { typeName: 'handlerA' | 'handlerB' };
  };
  handlerA: {
    input: { dataA: string };
    output: { result: string };
  };
  handlerB: {
    input: { dataB: number };
    output: { result: string };
  };
}>();
```

### Branching by Input (Polymorphic)

```typescript
defineJobTypes<{
  router: {
    entry: true;
    input: { path: string };
    continueWith: { input: { payload: unknown } };
  };
  handlerA: {
    input: { payload: unknown };
    output: { result: string };
  };
  handlerB: {
    input: { payload: unknown };
    output: { result: string };
  };
}>();
```

### Blockers with Mixed References

```typescript
defineJobTypes<{
  fetchUser: {
    entry: true;
    input: { userId: string };
    output: { user: User };
  };
  fetchPermissions: {
    entry: true;
    input: { userId: string };
    output: { permissions: string[] };
  };
  performAction: {
    entry: true;
    input: { action: string };
    output: { success: boolean };
    blockers: [
      { typeName: 'fetchUser' },
      { input: { userId: string } }  // matches fetchUser or fetchPermissions
    ];
  };
}>();
```

### Optional Continuation

```typescript
defineJobTypes<{
  process: {
    entry: true;
    input: { data: string };
    output: { done: true };  // can terminate here
    continueWith: { typeName: 'postProcess' };  // or continue
  };
  postProcess: {
    input: { processed: string };
    output: { finalized: boolean };
  };
}>();
```
