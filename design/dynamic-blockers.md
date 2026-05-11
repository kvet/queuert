---
status: design
supersedes: add-job-blocker.md
---

# Dynamic Blockers API Design

## Problem

Today, blockers are set once at creation time (`startChain` / `triggerJob`) and the handler receives them as a typed, always-present array. There's no way to _decide_ what to wait on after looking at runtime state — you'd have to split the work into two job types (a "decider" that uses `continueWith` with blockers, and a "worker" that does the real work). That split is awkward, leaks the decision into chain shape, and forces the worker type to redeclare the same blocker tuple.

Goal: let a handler decide at runtime what to wait on — without spreading workflow logic across caller and handler when a static declaration would be clearer.

## When To Use

The right way to think about static vs dynamic blockers is **where the dependency graph is decided**:

- **Static `blockers`** — caller knows the dependencies in hand at `startChain` time. Examples: a fan-in of three known sources, a "validate-then-action" pair where the caller already has both the user id and the config key. Compile-time enforcement at the call site is the win.
- **Dynamic `deferredBlockers`** — the dependencies _cannot_ be known by the caller because they require runtime discovery (DB query, API call, conditional logic on the job's input). Example: "aggregate report X" where the set of source fetches has to be looked up from a `report_sources` table the caller may not even have access to. Putting this discovery in the handler keeps logic cohesive — the alternative is forcing every caller to query first, which spreads workflow knowledge into call sites.

The footgun: using `deferredBlockers` to "simplify" a case where the caller actually does have the dependencies in hand. That just relocates data without changing intent and _does_ spread workflow logic. The two fields exist precisely so each use case picks the shape that fits.

## Non-Goals

- Replacing static `blockers`. They earn their keep — see [Verification: examples](#verification-examples).
- Untyped / opaque blockers. The `deferredBlockers: [...] as const` tuple stays load-bearing — same role as `blockers`'s tuple today, just for the dynamic path.
- Coroutine-style suspension (`const x = await waitFor(chain)` inline). Different design space; would require replayable handlers with determinism guarantees.
- Mutating blockers on _other_ jobs from arbitrary code. The dynamic path mutates only the running job's own blocker set. (We may still expose a low-level escape-hatch adapter method — see "Escape Hatch" below — but it's not the primary surface.)

## API Surface

### Definition: two fields, distinct semantics

```ts
defineJobTypes<{
  // Static-only — caller knows dependencies up front
  "perform-action": {
    input: { actionId: string };
    blockers: [{ typeName: "validate-user" }, { typeName: "load-config" }];
  };

  // Dynamic-only — handler discovers dependencies from runtime state
  "aggregate-data": {
    entry: true;
    input: { reportId: string };
    output: { reportId: string; totalSources: number; combinedData: string };
    deferredBlockers: [{ typeName: "fetch-source" }];
  };

  // Mixed — some are structural, some are discovered
  "process-payment": {
    input: { paymentId: string };
    blockers: [{ typeName: "fraud-check" }]; // always required
    deferredBlockers: [{ typeName: "currency-convert" }]; // only if foreign currency
  };
}>();
```

Handler input types follow directly:

| Type definition has…    | `job.blockers`        | `job.deferredBlockers`                    |
| ----------------------- | --------------------- | ----------------------------------------- |
| Neither                 | `never` / not present | `never` / not present                     |
| `blockers` only         | `BlockerChains<...>`  | `never` / not present                     |
| `deferredBlockers` only | `never` / not present | `DeferredBlockerChains<...> \| undefined` |
| Both                    | `BlockerChains<...>`  | `DeferredBlockerChains<...> \| undefined` |

Crucially, **declaring `blockers` does not introduce the `undefined` tax** — handlers that only use static blockers see today's exact shape. The optional type is local to handlers that opted into `deferredBlockers`.

### The handler lifecycle: prepare → spawn → reschedule

Dynamic blockers fit the existing prepare/complete pattern with `reschedule` taking `complete`'s slot when the handler decides to wait on something:

```ts
"aggregate-data": {
  attemptHandler: async ({ job, prepare, complete, startChain, reschedule }) => {
    if (job.deferredBlockers === undefined) {
      // Phase 1: prepare — read runtime state in a transaction.
      const config = await prepare({ mode: "staged" }, async ({ sql }) =>
        sql`SELECT source_id, url FROM report_sources WHERE report_id = ${job.input.reportId}`
      );

      // Phase 2: side-effect — spawn the discovered chains. Lease renews automatically.
      const fetches = await Promise.all(
        config.map((s) => startChain({ typeName: "fetch-source", input: s })),
      );

      // Phase 3: reschedule — append blockers atomically, flip to blocked, exit.
      return reschedule({ blockers: fetches });
    }

    // Resumed pass: deferredBlockers is populated, typed, and final.
    return complete(async () => ({
      reportId: job.input.reportId,
      totalSources: job.deferredBlockers.length,
      combinedData: job.deferredBlockers.map((b) => b.output.data).join(" | "),
    }));
  },
},
```

Three phases, mirroring today's `prepare → side-effect → complete`. The reschedule pathway is the _only_ new mechanic; everything else reuses existing infrastructure.

### `rescheduleJob` (throw form) extension

Today:

```ts
rescheduleJob({ schedule: "+5m" }); // throws RescheduleJobError
```

Proposed extension — same throw semantics, new optional field:

```ts
rescheduleJob({ blockers: DeferredBlockerChains<...> });
rescheduleJob({ blockers: DeferredBlockerChains<...>, schedule: "+5m" });
```

- `blockers` only: job goes blocked, re-acquires once blockers complete.
- `schedule` only: existing behavior unchanged.
- Both: job blocks on chains first, then honors `schedule` after they complete.

**Open: callable variant.** A `reschedule({ blockers })` callable from the handler context (parallel to `complete(...)`) reads more naturally for the prepare→spawn→reschedule lifecycle above and avoids the throw-as-control-flow pattern. The throw form stays useful for nested-abort cases. We're not committing to ship the callable in v1 — extend the throw form first; revisit the callable once usage patterns are visible.

### Type Constraints

- `rescheduleJob`'s `blockers` parameter is typed as `DeferredBlockerChains<JobTypes, ThisTypeName>` — the chains must match a `typeName` declared in the type's `deferredBlockers` menu. Same plumbing as today's `BlockerChains`.
- `attemptHandler`'s `job.deferredBlockers` is `DeferredBlockerChains<...> | undefined`. The optional shape _only_ appears when the type declares `deferredBlockers`.
- `attemptHandler`'s `job.blockers` is unchanged from today: present if the type declares `blockers`, typed as a non-optional resolved tuple.
- No `as Chain<any>` escape at the type level — if you need to wait on a chain type not in the menu, add it to `deferredBlockers`. Keeps the type-safety story honest.

## Schema Changes

### No new columns

Dynamic blockers reuse existing blocker accounting end-to-end. Whether that's today's `status = 'blocked'` denormalization or the boolean column proposed in [has-blockers.md](has-blockers.md), dynamic addition is _the same write path_ as creation-time addition — `addJobsBlockers` already does what we need; we just call it from a new entry point (the worker's `RescheduleJobError` catch).

We deliberately do _not_ introduce a `remaining_blockers_count` counter for this design. The counter was rejected in `has-blockers.md` for valid reasons: every blocker-chain completion would write to every dependent's `job` row, generating per-completion dead tuples on the hottest table (Postgres MVCC). Dynamic blockers would only worsen that profile by widening the set of dependents per chain. Whatever scaling answer `has-blockers.md` ultimately picks for `unblockJobs` is the answer this design rides on — they don't need to be coupled.

### Storage of dynamic vs static blockers

Both kinds of blocker chains are stored in the same `job_blocker` table — the only difference is the path that wrote them (creation-time vs reschedule-time). A `kind` discriminator column may be useful for observability/debugging ("which blockers did the handler add itself?") but is not required for correctness. Open question, see below.

## State Adapter Changes

### Modified: `addJobsBlockers`

- Already exists for creation-time blockers. Now also called from the worker when the handler throws `RescheduleJobError` with `blockers`.
- When called from a reschedule, also flips the running job into the blocked state and clears the lease in the same statement (whether "blocked state" is `status = 'blocked'` today or `has_blockers = true` post-`has-blockers.md` — same write path).

### New: `listJobBlockers` (paginated)

Carried over from the old design. Needed because dynamic blockers can grow the set well past what the existing un-paginated `getJobBlockers` is sized for.

```ts
listJobBlockers: (params: {
  txCtx?: TTxContext;
  jobId: TJobId;
  orderDirection: OrderDirection;
  page: PageParams;
}) => Promise<Page<[StateJob, StateJob | undefined]>>;
```

Existing `getJobBlockers` stays for the bounded creation-time-only case; handlers should prefer `listJobBlockers` once dynamic blockers are in play.

### Worker changes

- Catch `RescheduleJobError` as today; if `blockers` is present, route through `addJobsBlockers` inside the same transaction instead of just updating `scheduled_at`.
- Notify integration: same notify path as creation-time blockers — appended chains' completion events trigger the existing `unblockJobs` flow.
- `job.deferredBlockers` projection: the worker's job-fetch path needs to project resolved deferred-blocker chains the same way it projects today's static blockers, so the handler sees them populated on resume.

## Verification: examples

Surveying the existing examples ([showcase-blockers/src/index.ts](../examples/showcase-blockers/src/index.ts), [showcase-queries/src/index.ts](../examples/showcase-queries/src/index.ts), [observability-otel/src/index.ts](../examples/observability-otel/src/index.ts), [dashboard/src/start.ts](../examples/dashboard/src/start.ts), [showcase-slices/src/slice-orders-processors.ts](../examples/showcase-slices/src/slice-orders-processors.ts)):

- All six current uses fit the **static** profile — caller has the dependencies in hand. Tuple destructuring (`const [a, b] = job.blockers`) and array iteration depend on always-present typing. Collapsing to a single optional field would inflict an `undefined` check on every existing call site to enable a feature none of them use.
- The shapes that _would_ benefit from `deferredBlockers` aren't in the repo today not because demand is absent but because the API doesn't permit them — e.g., "aggregate-data figures out its own sources from the DB" is currently impossible without splitting into two job types.

The two-field design preserves today's ergonomics while adding genuine new capability behind an opt-in field.

## Escape Hatch: low-level `addJobBlocker` (deferred)

Optional. Expose an adapter-level (and optionally client-level) `addJobBlocker({ jobId, blockers })` for cross-job injection — e.g., a separate workflow needs to gate an existing job on something it just spawned. Constraints if/when shipped:

- Allowed only on `pending` or `blocked` jobs (not `running`/`completed`).
- Bypasses the static / deferred menus — opaque `Chain<any>[]` only. Documented as escape-hatch usage; the typed paths are creation-time `blockers` and `rescheduleJob({ blockers })`.

This was the _primary_ API in the old `add-job-blocker.md`. Demoting it to an optional escape hatch keeps the typed surfaces clean while preserving the underlying capability if a real use case appears.

## Observability

- Per-blocker spans at reschedule time still fine for typical fan-out (handful of chains). For pathological cases (1000s spawned in one reschedule), aggregate into a single `blockers.added` span with `count` attribute.
- The existing `RescheduleJobError` span/log treatment extends naturally — add a `reschedule.reason: "blockers"` attribute when blockers are present, reusing the same span shape.
- Worth distinguishing static vs dynamic blockers in spans/dashboard so operators can see at a glance which were declared up front vs added by the handler. Hooks into the optional `kind` column above if shipped.

## Open Questions

1. **Callable `reschedule(...)` vs throw-only `rescheduleJob(...)`.** The callable parallels `complete(...)` and reads better in the prepare→spawn→reschedule lifecycle. The throw form is what exists today and stays useful for nested abort. Lean: ship throw-form extension first; revisit callable after usage patterns are visible.
2. **`schedule` + `blockers` together**: should both be allowed on the same `rescheduleJob` call, or rejected? "Wait for X, then wait Y more" is a real pattern (e.g., "wait for upload, then 30s settle time"). Default: allow, document precedence as "blockers first, then schedule."
3. **Reschedule from atomic-mode prepare**: today `rescheduleJob` is callable from the attempt handler; can it also be thrown from inside `prepare`? Probably yes, but worth confirming — prepare runs in its own savepoint, so the mechanics work, but the semantics ("I rescheduled before doing anything") may surprise.
4. **Self-reschedule loop guard**: a buggy handler could reschedule itself repeatedly with one trivially-completing blocker each time. No different from today's risk of `rescheduleJob({ schedule: "+1ms" })` infinite-loop, but worth a paragraph in docs.
5. **`kind` discriminator column** on `job_blocker` for static vs dynamic. Useful for observability; not required for correctness.
6. **Empty `blockers` array** passed to `rescheduleJob({ blockers: [] })`: throw at runtime ("almost certainly a bug — call `complete` if you have nothing to wait on") or no-op (treat as a plain reschedule). Lean: throw.
7. **Escape-hatch necessity**: ship without `addJobBlocker` and only add it if real users hit a case `rescheduleJob({ blockers })` can't cover. Probably yes — fewer public surfaces to commit to.

## Implementation Order

1. Type-system surface: add `deferredBlockers` field to job-type definitions; expose `DeferredBlockerChains<...>` and `job.deferredBlockers?: ...` derived types, mirroring today's `BlockerChains`.
2. Extend `RescheduleJobError` to carry `blockers`; extend `rescheduleJob()` helper signature accordingly, typed against the deferred menu.
3. Worker: in the catch path for `RescheduleJobError`, route to `addJobsBlockers` when blockers present (same write path as creation-time addition).
4. Update `addJobsBlockers` to flip the job into the blocked state and clear the lease when called from a reschedule.
5. Worker job-fetch projection: include resolved deferred-blocker chains so `job.deferredBlockers` is populated on resume.
6. In-process adapter: mirror the reschedule path.
7. Add `listJobBlockers` (paginated) to adapter + client.
8. Tests + reference doc + a guide page on "deciding what to wait on at runtime" (with the static-vs-dynamic decision tree).
9. Add an example (`showcase-deferred-blockers`) demonstrating the runtime-discovery pattern (DB-driven fan-out).
10. (Defer) Callable `reschedule(...)` variant if the throw form proves awkward in practice.
11. (Defer) Escape-hatch `addJobBlocker` only if needed.
