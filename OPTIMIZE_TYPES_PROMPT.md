## Task: Optimize Queuert type system for 100 slices × 20 jobs without losing type safety

### Context

Queuert is a TypeScript job queue library with a rich type system that traces job chains (entry → step1 → step2 → ...) and resolves types for jobs, chains, blockers, and continuations. When users merge multiple independent "slices" (each slice is a self-contained set of job type definitions) into a single worker, the merged type `MergedDefs` (a flat intersection of all slice definitions) flows into navigation types that compute reachability graphs. These navigation types are O(N²) in the total number of job types, causing TypeScript to hit millions of instantiations at scale.

The goal: **100 slices × 20 jobs (with branching and blockers) must type-check in reasonable time** (~200k–400k instantiations for the worker setup).

### The three bottleneck sites

All three are in the `createInProcessWorker` call path. When the user writes:

```ts
const client = await createClient({ stateAdapter, notifyAdapter, registry: mergedRegistry });
const worker = await createInProcessWorker({ client, processors: mergedProcessors });
```

TypeScript must:

**Site 1 — Infer `TJobTypeDefinitions` from `client: Client<TJobTypeDefinitions, TStateAdapter>`** (`packages/core/src/in-process-worker.ts`, around line 232)

`Client` is defined as `Awaited<ReturnType<typeof createClient<...>>>` (`packages/core/src/client.ts:730-733`). To infer the type parameter, TS structurally matches the client object against the full return type of `createClient`, which forces evaluation of ALL 11 method signatures. Each method defaults its type parameter to the full entry/job type union and returns `ResolvedJobChain`/`ResolvedJob`/`ResolvedChainJobs` — all distributive conditional types that trigger `ChainJobTypeNames` (recursive chain walk) and `ChainReachMap` (N² reachability map) from `packages/core/src/entities/job-type.navigation.ts`.

**Site 2 — Validate `TJobTypeProcessors extends InProcessWorkerProcessors<TStateAdapter, TJobTypeDefinitions>`** (`packages/core/src/in-process-worker.ts`, around line 234)

`InProcessWorkerProcessors` is a mapped type over `keyof TJobTypeDefinitions & string` (line 58-68 in same file). Each slot contains `InProcessWorkerProcessor<SA, MergedDefs, K>` which includes `AttemptHandler<SA, MergedDefs, K>` — and each `AttemptHandler` computes `ChainTypesReaching<MergedDefs, K>`, `ContinuationJobs<..., MergedDefs, K>`, `BlockerChains<..., MergedDefs, K>`, and `ResolvedJobWithBlockers<..., MergedDefs, K>`. That's 2000 keys × full navigation per key.

**Site 3 — Expand `JobAttemptMiddleware<TStateAdapter, TJobTypeDefinitions>`** (`packages/core/src/worker/job-process.ts:57-73`)

The middleware's `job` parameter is typed as `ResolvedJobWithBlockers<JobId, MergedDefs, keyof MergedDefs & string, keyof EntryDefs<MergedDefs> & string>`. This distributes `ResolvedJobWithBlockers` over a 2000-member job type union AND a 100-member entry type union simultaneously.

### The fix — three parts

The principle: **type safety is enforced at slice definition boundaries, not at the merge point**. Each slice's processors are already validated against their own `SliceDefs` via `satisfies InProcessWorkerProcessors<SA, SliceDefs>`. The merge is runtime concatenation. `createInProcessWorker` should NOT re-expand all navigation types against `MergedDefs`.

#### Part A — Phantom brand on Client (fixes Site 1)

Add a unique symbol that carries `TJobTypeDefinitions` without structural matching:

1. In `packages/core/src/client.ts`:
   - Create `declare const clientDefinitions: unique symbol;` and export it (or just the type)
   - In `createClient`'s return object, add `[clientDefinitions]: undefined as unknown as TJobTypeDefinitions`
   - Update the `Client` type to include the brand

2. In `packages/core/src/in-process-worker.ts`:
   - Change `createInProcessWorker`'s `client` parameter to infer `TJobTypeDefinitions` from the phantom brand: `client: Client<TJobTypeDefinitions, TStateAdapter>` stays as the surface type, but internally use an overload or conditional that lets TS infer from `{ [clientDefinitions]: TJobTypeDefinitions }` instead of matching all methods
   - The key insight: TS must be able to infer `TJobTypeDefinitions` from just the symbol property, not from the full Client structure

#### Part B — Weaken processor constraint at merge boundary (fixes Site 2)

The constraint `TJobTypeProcessors extends InProcessWorkerProcessors<TStateAdapter, TJobTypeDefinitions>` forces TS to evaluate the full mapped type. Since merged processors come from `mergeJobTypeProcessors` (which returns `{ [K in MergedKeys]: InProcessWorkerProcessor<any, any, K> }`), the definitions are already `any`.

Change the constraint so it doesn't expand navigation types for each key. Options:
- Use `any` in the definitions position of the constraint: `InProcessWorkerProcessors<TStateAdapter, TJobTypeDefinitions>` → a version that doesn't flow `TJobTypeDefinitions` into `AttemptHandler`'s navigation types
- Or restructure `InProcessWorkerProcessors` to separate key-checking from deep type validation
- The excess-property check (`Record<Exclude<keyof TJobTypeProcessors & string, keyof TJobTypeDefinitions & string>, never>`) should stay — it's cheap and catches typos

The important invariant: **inline (non-merge) usage must still get full type inference**. When a user writes `createInProcessWorker({ client, processors: { "my-job": { attemptHandler: ... } } })`, the processor should still be fully typed against the client's definitions. Only the merged case (where processors come from `mergeJobTypeProcessors`) should skip deep validation.

#### Part C — Base type for attempt middleware (fixes Site 3)

`JobAttemptMiddleware<TStateAdapter, TJobTypeDefinitions>` distributes `ResolvedJobWithBlockers` over all types. But middlewares are generic wrappers — they don't discriminate by job type.

Change the middleware's `job` parameter to use a non-distributive base type:
- Instead of `ResolvedJobWithBlockers<JobId, TDefs, keyof TDefs & string, keyof EntryDefs & string>`
- Use something like `RunningJob<JobWithBlockers<Job<JobId, string, string, unknown>, CompletedJobChain<JobChain<JobId, string, unknown, unknown>>[]>>`
- Or introduce a `BaseResolvedJobWithBlockers<TJobId>` that doesn't distribute

This means middlewares see `job.typeName` as `string` instead of a union of all 2000 type names. That's fine — middlewares that need specific types can narrow with `if (job.typeName === "x")`.

### Files to modify

- `packages/core/src/client.ts` — add phantom brand symbol to `createClient` return and `Client` type
- `packages/core/src/in-process-worker.ts` — change inference to use brand; weaken processor constraint for merged case
- `packages/core/src/worker/job-process.ts` — simplify `JobAttemptMiddleware` job parameter type
- `packages/core/src/entities/job-type.navigation.ts` — potentially no changes needed
- `packages/core/src/worker/merge-job-type-processors.ts` — may need to adjust return type
- `packages/core/src/index.ts` — export new symbol if needed

### Validation

- Run `pnpm fmt` then `pnpm check` (runs lint, typecheck, test, examples) — everything must pass
- Run the benchmark: `cd examples/benchmark-type-complexity && pnpm tsx src/index.ts tsc`
- Target: `many-20x3` (20 slices × 3-step chains = 60 types) should stay under ~50k instantiations
- Stretch: add `many-100x20` scenario to the benchmark and verify it type-checks without errors in reasonable time
- Verify inline (non-merge) processor usage still has full type inference (test by checking that existing specs and examples compile)

### Constraints

- Read `docs/src/content/docs/advanced/` reference docs before modifying core types
- Read `code-style.md` for testing patterns
- Don't add obvious comments
- Run `pnpm fmt` before `pnpm check`
- Don't break the public API surface — `Client`, `createInProcessWorker`, `mergeJobTypeRegistries`, `mergeJobTypeProcessors` must remain compatible
- Preserve full type safety for single-slice (non-merge) usage — this is the common case and must not regress
