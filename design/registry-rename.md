# Registry Rename: `JobTypes` + `Processors`

Rename the two "registry" artifacts to drop the shared `Registry` suffix and the redundant `JobType` prefix on the processor side. Addresses the "rethink long names" item in [TODO.md](../TODO.md).

## Problem

Two distinct concepts share the "registry" label today:

- **`JobTypeRegistry`** — schema. Declares what job types exist and their I/O shapes. Holds validators, no implementations.
- **`JobTypeProcessorRegistry`** — implementation map. Maps job type names to processor configs (handler + per-type options).

They are as different as a Protobuf `.proto` file is from a gRPC server, yet both end in `Registry`. The compound prefixes that follow (`JobTypeProcessor…`) produce identifiers up to 43 characters long:

| Today                                         | Length |
| --------------------------------------------- | ------ |
| `createJobTypeProcessorRegistry`              | 30     |
| `mergeJobTypeProcessorRegistries`             | 31     |
| `ExternalJobTypeProcessorRegistryDefinitions` | 43     |

Long names are the surface; naming two different things the same thing is the cause.

## Proposed

**Schema side → `JobTypes`.** Drop the `Registry` suffix. The word "types" already says "collection"; no container noun needed.

**Processor side → `Processors`.** Drop both `JobType` and `Registry`. In worker context, processors are always job-type processors — context resolves the dropped prefix.

Asymmetric roots (`JobTypes` ≠ `Processors`) do the disambiguation work the symmetric `…Registry` suffix was failing at.

```typescript
const orderJobTypes = defineJobTypes<{
  "orders.create":  { entry: true; input: {…}; continueWith: { typeName: "orders.fulfill" } };
  "orders.fulfill": { input: {…}; output: {…} };
}>();

const orderProcessors = createProcessors({
  client,
  jobTypes: orderJobTypes,
  processors: {
    "orders.create":  { attemptHandler: async ({ complete }) => … },
    "orders.fulfill": { attemptHandler: async ({ complete }) => … },
  },
});

const client = await createClient({
  stateAdapter, notifyAdapter,
  jobTypes: mergeJobTypes({ slices: [orderJobTypes, notificationJobTypes] }),
});

const worker = await createInProcessWorker({
  client,
  processors: mergeProcessors({ slices: [orderProcessors, notificationProcessors] }),
});
```

## Complete rename table

| Kind   | Today                                                 | Proposed                                |
| ------ | ----------------------------------------------------- | --------------------------------------- |
| Fn     | `defineJobTypeRegistry<T>()`                          | `defineJobTypes<T>()`                   |
| Fn     | `createJobTypeRegistry(config)`                       | `createJobTypes(config)`                |
| Fn     | `mergeJobTypeRegistries({ slices })`                  | `mergeJobTypes({ slices })`             |
| Fn     | `createJobTypeProcessorRegistry(options)`             | `createProcessors(options)`             |
| Fn     | `mergeJobTypeProcessorRegistries({ slices })`         | `mergeProcessors({ slices })`           |
| Type   | `JobTypeRegistry<TDefs, TExt, TMerged>`               | `JobTypes<TDefs, TExt, TMerged>`        |
| Type   | `JobTypeRegistryConfig`                               | `JobTypesConfig`                        |
| Type   | `JobTypeRegistryDefinitions<T>`                       | `JobTypeDefinitions<T>`                 |
| Type   | `ExternalJobTypeRegistryDefinitions<T>`               | `ExternalJobTypeDefinitions<T>`         |
| Type   | `JobTypeProcessorRegistry<TDefs, TExt>`               | `Processors<TDefs, TExt>`               |
| Type   | `JobTypeProcessorRegistryDefinitions<T>`              | `ProcessorDefinitions<T>`               |
| Type   | `ExternalJobTypeProcessorRegistryDefinitions<T>`      | `ExternalProcessorDefinitions<T>`       |
| Type   | `DefineJobTypes<T>` (identity helper)                 | `JobTypesSpec<T>`                       |
| Symbol | `mergedRegistrySymbol`                                | `mergedJobTypesSymbol`                  |
| Field  | `createClient({ jobTypeRegistry })`                   | `createClient({ jobTypes })`            |
| Field  | `createInProcessWorker({ jobTypeProcessorRegistry })` | `createInProcessWorker({ processors })` |
| Field  | `createProcessors({ jobTypeRegistry })`               | `createProcessors({ jobTypes })`        |
| Field  | `createProcessors({ …, processors: {…} })`            | keep `processors:`                      |

## Collisions and their fixes

### 1. `defineJobTypes()` function vs. `DefineJobTypes<T>` identity type

`DefineJobTypes<T extends BaseJobTypeDefinitions> = T` at [packages/core/src/entities/job-type.ts:29](../packages/core/src/entities/job-type.ts) is a pure IntelliSense helper for users splitting definitions into their own file. After the rename, a function `defineJobTypes()` and a type `DefineJobTypes` differ only by case — ambiguous in imports on case-insensitive filesystems, confusing in documentation.

**Fix:** rename the type to `JobTypesSpec<T>`. Use site: `const specs: JobTypesSpec<{…}> = {…}` followed by `defineJobTypes<typeof specs>()`. Alternative: drop the helper entirely and have users annotate with `BaseJobTypeDefinitions` directly — it's identity, so no semantics are lost.

### 2. `createProcessors({ processors: {…} })` self-echo

The inner field keyed by job type name is itself called `processors:`. The call-site reads the word twice.

**Decision: keep the inner `processors:` as-is. Accept the echo.**

- Each entry is a processor config object (`{ attemptHandler, … }`), not a bare handler. `handlers:` was considered and rejected — `handlers["orders.create"].attemptHandler` is worse than `processors["orders.create"].attemptHandler`, and grows more misleading as per-type config fields accumulate (middleware, lease config, retry policy).
- The echo resolves on a second read ("create processors from this processors-map"). Prior art: `createStore({ reducer })`, `defineConfig({ config })`, `createRouter({ routes })`.
- Alternatives (`implementations:`, `byType:`, `entries:`) are more bureaucratic without being clearer.

### 3. `createClient({ jobTypes })` — no existing field collision

Confirmed: neither `createClient` nor `createInProcessWorker` currently has a `jobTypes` field.

## Friction accepted

- **"Create job types" can misread as "create job instances."** The config shape (validators, external defs) resolves it in practice. Same ambiguity exists in every factory-of-collection API (`createServer`, `createStore`).
- **Namespace density around `JobType*`.** After the rename, the visible names include `JobType`, `JobTypes`, `JobTypeNames`, `JobTypeDefinitions`, `BaseJobTypeDefinitions`, `JobTypesSpec`, `JobTypesConfig`, `JobTypeReference`. All distinct, none colliding, but this is the ceiling — adding another `JobType*` type after this should pause.
- **`Processors` is a common word.** A user importing `Processors` into a file may already have a local `Processors` type. Users more commonly import the extractor (`ProcessorDefinitions`) than the full type, so real-world risk is low.
- **`mergeJobTypes` prose reading.** "Merge job types from all slices" is slightly vaguer than "merge job type registries." In long-form docs prefer "merge job type definitions" where precision matters. Zero code impact.

## Alternatives considered

1. **Status quo (`JobTypeRegistry` + `JobTypeProcessorRegistry`).** Unambiguous but verbose; every call site pays.
2. **`JobTypeSchema` + `ProcessorRegistry`.** Asymmetric and collision-free, but keeps one "Registry" in play and "Schema" collides with Zod schemas used internally for validation.
3. **`JobTypes` + `Processors` with inner `handlers:`.** Forces `handlers["x"].attemptHandler`, which is worse than the outer-echo it tries to avoid — and becomes dishonest if processor entries grow beyond handlers.
4. **Unified `Slice` concept (one factory bundling types + processors).** Bigger redesign. Reduces API surface more aggressively, but collapses the schema/implementation separation that producers-only setups and type-only slice sharing rely on. Out of scope for a rename.

## Migration

Breaking change. Codemod-friendly — every rename is a one-to-one identifier swap except the `DefineJobTypes` → `JobTypesSpec` type helper (trivial find-and-replace, no shape change).

Scope:

- `packages/core/src` — ~456 identifier rewrites.
- `packages/postgres|sqlite|redis` — re-export only, minimal touches.
- `examples/` — ~560 rewrites across ~30 example directories.
- `docs/` — ~162 mentions of "registry" in this context.

Deprecation plan: ship both surfaces for one minor release with `@deprecated` aliases, remove old names in the next major.

## Open questions

- **Keep both `defineJobTypes<T>()` and `createJobTypes(config)`?** Today's split is compile-time-only vs. runtime-validated. The rename preserves both. Worth revisiting whether the split earns its keep, but that is a separate design concern.
- **`JobTypesConfig` vs. `JobTypesOptions`.** Existing convention in the codebase leans `Config`; confirm consistency with other options-bag types before finalizing.
- **Symbol renames.** `processorDefinitionsSymbol` and `processorExternalDefinitionsSymbol` already match the new vocabulary and can stay. `mergedRegistrySymbol` needs `mergedJobTypesSymbol` — verify no external code paths reach it.
