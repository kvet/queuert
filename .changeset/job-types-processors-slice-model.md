---
"queuert": major
"@queuert/postgres": patch
---

Rework the registry API around composable slices, redesign the attempt-middleware surface, and fix a blocker-insertion race in the Postgres state adapter.

**Composable slices replace the old registry pair.** `JobTypeRegistry` and `JobTypeProcessorRegistry` were two parallel surfaces with their own merge helpers; both are now `JobTypes` / `Processors` slices that `createClient` and `createInProcessWorker` accept either alone or as an array, merging inline. The standalone `mergeJobTypeRegistries` / `mergeJobTypeProcessorRegistries` functions are no longer public.

**`AttemptMiddleware` replaces `JobAttemptMiddleware`.** The new shape is onion-style with `wrapHandler` / `wrapPrepare` / `wrapComplete` hooks that receive `next(ctx)` and inject typed context into the handler / prepare / complete callbacks. Middleware now lives on the `Processors` slice (via `createProcessors({ attemptMiddleware })`), so each slice runs its own chain instead of every job sharing a worker-wide list.

**`createInProcessWorker` options restructured.** `jobTypeProcessorDefaults` is gone — `pollIntervalMs` is a top-level option and per-job-type `backoffConfig` / `leaseConfig` defaults belong on `createProcessors`. The old worker-loop `backoffConfig` (controlling the worker's own crash-recovery loop, not job retries) is renamed to `recoveryBackoffConfig` so it stops being confused with per-attempt retry backoff.

### Renames

#### Type and function symbols

| Before                                | After                        |
| ------------------------------------- | ---------------------------- |
| `JobTypeRegistry`                     | `JobTypes`                   |
| `createJobTypeRegistry`               | `createJobTypes`             |
| `defineJobTypeRegistry`               | `defineJobTypes`             |
| `DefineJobTypes`                      | `JobTypeDefs`                |
| `JobTypeRegistryConfig`               | `JobTypesOptions`            |
| `JobTypeRegistryDefinitions`          | `JobTypeDefinitions`         |
| `ExternalJobTypeRegistryDefinitions`  | `ExternalJobTypeDefinitions` |
| `JobTypeProcessorRegistry`            | `Processors`                 |
| `createJobTypeProcessorRegistry`      | `createProcessors`           |
| `JobTypeProcessorRegistryDefinitions` | `ProcessorDefinitions`       |
| `JobAttemptMiddleware`                | `AttemptMiddleware`          |

#### Removed exports

- `mergeJobTypeRegistries` — pass an array of slices to `createClient({ jobTypes: [...] })`.
- `mergeJobTypeProcessorRegistries` — pass an array of slices to `createInProcessWorker({ processors: [...] })`.
- `ExternalJobTypeProcessorRegistryDefinitions` — no longer needed; processor type inference derives definitions from the slice's own `JobTypes`.
- `JobTypeProcessorDefaults` — folded into `createInProcessWorker` top-level options and `createProcessors` registry-level options.

#### `createClient` options

| Before            | After      |
| ----------------- | ---------- |
| `jobTypeRegistry` | `jobTypes` |

`jobTypes` accepts a single `JobTypes` slice or a non-empty `readonly` array of slices to merge inline. Duplicate type names across slices are flagged at compile time (`Duplicate job type: <name>`).

#### `createInProcessWorker` options

| Before                                        | After                                                 |
| --------------------------------------------- | ----------------------------------------------------- |
| `jobTypeProcessorRegistry`                    | `processors`                                          |
| `jobTypeProcessorDefaults.pollIntervalMs`     | `pollIntervalMs` (top-level)                          |
| `jobTypeProcessorDefaults.backoffConfig`      | `createProcessors({ backoffConfig })` (per slice)     |
| `jobTypeProcessorDefaults.leaseConfig`        | `createProcessors({ leaseConfig })` (per slice)       |
| `jobTypeProcessorDefaults.attemptMiddlewares` | `createProcessors({ attemptMiddleware })` (per slice) |
| `backoffConfig`                               | `recoveryBackoffConfig`                               |

### New APIs

- **`createProcessors({ client, jobTypes, attemptMiddleware?, backoffConfig?, leaseConfig?, processors })`** — builds a `Processors` slice tied to a specific `JobTypes` slice. Validates at compile time that the client has every type the slice declares, and that `processors` keys are a subset of the slice's type names. Registry-level `backoffConfig` / `leaseConfig` cascade onto every processor unless overridden.
- **`AttemptMiddleware<TStateAdapter, THandlerCtx, TPrepareCtx, TCompleteCtx>`** — onion middleware with all-optional `wrapHandler` / `wrapPrepare` / `wrapComplete` hooks. Each hook receives `next(ctx)` and the merged ctx from every middleware in the chain is exposed on the handler / prepare / complete callback options.
- **`UnknownJobTypeError`** — thrown by a merged `JobTypes` when a referenced type name is not owned by any slice. Only raised when every slice in the merge was built with `createJobTypes`; mixed merges that include a `defineJobTypes` slice fall back to no-op validation for unknown types (consistent with single-slice behavior).
- **`runValidationAdapterConformance`** — new conformance suite exported from `queuert/conformance` for validation-adapter authors. Combined runtime + type-level check; mirrors `runStateAdapterConformance` in shape. Companion exports: `ValidationAdapterConformanceContext`, `ValidationConformanceFixture`, `ValidationConformanceOptions`.

### Postgres race fix

`@queuert/postgres`: `addJobsBlockersSql` now acquires `FOR UPDATE` on the latest job of each blocker chain (via a new `locked_blocker_chain_latest` CTE) before inserting blocker rows. Closes a race where a blocker chain could complete between the status read and the blocker insert, leaving the blocked job stuck. No schema change; queries are rewritten internally and run via the existing connection.

### Migration

TypeScript will flag every wrong call site at compile time — there is no runtime fallback or deprecation period.

1. **Rename symbols.** Bulk-replace the names in the renames table. `createJobTypeRegistry` → `createJobTypes`, `defineJobTypeRegistry` → `defineJobTypes`, `JobTypeRegistry` → `JobTypes`, `createJobTypeProcessorRegistry` → `createProcessors`, `JobAttemptMiddleware` → `AttemptMiddleware`, `DefineJobTypes` → `JobTypeDefs`.
2. **Drop merge helpers.** Replace `createClient({ jobTypeRegistry: mergeJobTypeRegistries([a, b]) })` with `createClient({ jobTypes: [a, b] })`. Replace `createInProcessWorker({ jobTypeProcessorRegistry: mergeJobTypeProcessorRegistries([a, b]) })` with `createInProcessWorker({ processors: [a, b] })`. Single-slice usage: pass the slice directly.
3. **Restructure worker options.** Pull `pollIntervalMs` out of `jobTypeProcessorDefaults` and put it at the top level of `createInProcessWorker`. Move per-type `backoffConfig` / `leaseConfig` defaults onto `createProcessors`. Move `attemptMiddlewares` (now `attemptMiddleware`) onto `createProcessors` — the middleware chain is per-slice, not per-worker. Rename the worker-loop `backoffConfig` to `recoveryBackoffConfig`.
4. **Rewrite middleware.** Replace `before` / `after` middleware with `wrapHandler` / `wrapPrepare` / `wrapComplete` and call `next(ctx)` to forward to the next layer. The chain composes onion-style: the first middleware's "before" code runs outermost. Ctx returned via `next(ctx)` is merged into the inner callback's options.
5. **Adopt the new validation conformance suite.** Custom validation adapters can replace ad-hoc tests with `runValidationAdapterConformance` from `queuert/conformance`.
