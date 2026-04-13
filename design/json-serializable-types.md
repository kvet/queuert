# Enforce JSON-Serializable Inputs and Outputs

## Problem

Job `input` and `output` are typed as `unknown` in `BaseJobTypeDefinition`. Non-JSON-serializable values (e.g. `Date`, `Map`, `Set`, `bigint`) are accepted at compile time but silently break on DB round-trip:

- **SQLite adapter**: calls `JSON.stringify(input)` — a `Date` becomes a string, deserialized as that string (type mismatch)
- **Postgres adapter**: pg driver stringifies internally — same silent coercion
- **In-process adapter**: stores by reference — hides the bug entirely during testing

## Current State

The only compile-time constraint is `NoVoidOrUndefined<T>` in `ValidateJobType` ([job-type.validation.ts](../packages/core/src/entities/job-type.validation.ts)). Everything else passes through.

## Proposed Approach

### Type Definition

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonSerializable =
  | JsonPrimitive
  | readonly JsonSerializable[]
  | { readonly [key: string]: JsonSerializable | undefined };
```

`undefined` is allowed in object value positions to support optional properties (`{ label?: string }` desugars to `{ label: string | undefined }`).

### Where to Apply

Add an `IsJsonSerializable<T>` check in `ValidateJobType` alongside the existing `NoVoidOrUndefined`, in [job-type.validation.ts](../packages/core/src/entities/job-type.validation.ts). This is the natural place — no changes to `BaseJobTypeDefinition` itself.

### Touch Points

- `ValidateJobType` — primary enforcement point
- `BaseJobTypeDefinition` — keep as `unknown` (runtime adapter interface is decoupled from type-level contract)
- `JobTypeProperty` resolver — inherits constraint automatically
- Client, processor, middleware — all derive types from the registry, no changes needed

## Codec Approach (Zod/Valibot)

Rather than just banning `Date`, support a codec pattern where:

- The **serialized type** (DB storage) is constrained to `JsonSerializable`
- The **runtime type** (handler receives) can be `Date`, custom classes, etc.
- The validation library handles the transform in both directions

```ts
// Example: Zod codec
const dateCodec = z.string().datetime().transform(s => new Date(s));
// z.input<typeof dateCodec>  → string  (JSON-safe, stored in DB)
// z.output<typeof dateCodec> → Date    (runtime, passed to handler)
```

The `JsonSerializable` constraint would apply to `z.input<Schema>` (serialized form) rather than `z.output<Schema>` (runtime form). This gives users type-safe `Date` in handlers while keeping storage JSON-clean.

## Known Issues

### Breaking Changes

- **`unknown` in structural references**: The codebase uses `input: unknown` in structural job type references (~12+ places in specs). A flat ban breaks this pattern. Needs a carve-out or a separate type for structural references.
- **`Date` in existing user code**: Any user with `Date` in job types gets a compile error. The codec approach provides a migration path.
- **Zod `z.date()`**: Infers as `Date`, would fail the check. Users must switch to codec pattern (`z.string().datetime().transform(...)`) or use `z.string()`.

### TypeScript Limitations

- **`any` escapes**: `any extends JsonSerializable` always passes — intentional, preserves existing behavior
- **Class instances sneak through**: `class Foo { x: string }` structurally matches `{ x: string }` — TS can't distinguish class instances from plain objects
- **Error messages**: Deeply nested failures point at the outermost type, not the offending inner property
- **Depth limits**: Recursive conditional types may hit TS instantiation limits on very deep payloads — measure with existing `benchmarks/type-complexity/` infrastructure
- **`never` propagation**: An inner property failing makes the entire parent `never`, producing confusing errors

### Design Decisions Needed

1. **Hard constraint vs soft helper**: Make it a compile error in the core, or export `EnsureJsonSerializable<T>` as an opt-in utility?
2. **`unknown` carve-out**: How to handle structural job type references that use `input: unknown`?
3. **Codec integration**: How deep should the codec support go? Just types, or runtime serialize/deserialize hooks in the adapter layer?

## Files

| File | Role |
|------|------|
| `packages/core/src/entities/job-type.ts` | `BaseJobTypeDefinition` — `input: unknown` |
| `packages/core/src/entities/job-type.validation.ts` | `ValidateJobType`, `NoVoidOrUndefined` — enforcement point |
| `packages/core/src/entities/define-job-type-registry.ts` | Public API entry point |
| `packages/core/src/entities/job-type-registry.resolvers.ts` | `JobTypeProperty` — distributes types to all call sites |
| `packages/core/src/entities/define-job-type-registry.spec.ts` | Type specs, `unknown` usage at lines 935–1204 |
| `packages/sqlite/src/state-adapter/state-adapter.sqlite.ts` | `JSON.stringify(input)` at line 348, `JSON.parse()` at lines 65/78 |
| `packages/postgres/src/state-adapter/state-adapter.pg.ts` | Input passed to pg driver at line 188 |
| `examples/validation-zod/src/zod-adapter.ts` | Zod integration pattern |
| `benchmarks/type-complexity/src/index.ts` | Type-checking benchmark |
