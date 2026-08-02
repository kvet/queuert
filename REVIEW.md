# Code Review: reads by deduplication + drop `TransactionContextRequiredError`

## Summary

Two changes ship together: `getChain`/`getChains` gain a non-id lookup form that resolves the chain a `createChain` with the same `DeduplicationOptions` would collapse onto (new `StateAdapter.getChainsByDeduplication`, implemented in-process/PG/SQLite, with a new `chain_deduplication_idx` replacing `job_deduplication_idx`), and `TransactionContextRequiredError` is removed in favour of a plain `Error`. Overall this is high-quality, well-tested work — the conformance group and the dedup suite cover scope/window/exclude/positional/lock behaviour across all three adapters, docs and index tables are updated in lockstep, and both changesets exist with the right bump levels. Typecheck passes (`bun run typecheck`, exit 0). The findings below are mostly about a documented guarantee that the implementation doesn't quite make, and a few gaps around the new runtime guards.

## Critical Issues

None.

## Concerns

**1. The lock does not cover the resolution, but the docs imply it does.**
`packages/postgres/src/state-adapter/state-adapter.pg.ts:895-937` — the `resolved` CTE evaluates the dedup predicates (`scope`, `windowMs`, `excludeChainIds`) against the transaction's unlocked snapshot; only afterwards does `locked_resolved_latest` take `FOR UPDATE` on the chain's latest job. Under READ COMMITTED the predicate is never re-evaluated after the lock is granted. So `getChain({ deduplication: { scope: "running" }, lock: true })` can block on a tail row held by a concurrent completer and then return that chain as if it were still running. The `id` form has no analogous window (PG's EPQ re-reads the locked row).

That is arguably acceptable — `TODO.md` already records that PG dedup on the *create* side is non-atomic (#3) — but the changeset and `docs/src/content/docs/guides/deduplication.md` both call this "the primitive behind keyed-singleton schedulers", which reads as a stronger guarantee than exists. The docs do caveat the create-if-absent race; they don't caveat the "resolved chain may already have left scope" race. Add one sentence, and note it in the changeset bullet about `lock: true`.

**2. Ties on `created_at` can make the read disagree with the create it claims to mirror.**
PG uses `DISTINCT ON (i.ord) … ORDER BY i.ord, j.created_at DESC` (`state-adapter.pg.ts:918`), SQLite `ORDER BY d.created_at DESC LIMIT 1` (`state-adapter.sqlite.ts:829`) — neither has a tiebreaker, and neither does the `existing_deduplicated` CTE in `createChains`. Two same-key head jobs created in the same transaction (or within SQLite's `datetime('now','subsec')` millisecond resolution) make both the read and the create pick arbitrarily, and independently. The documented contract is "the chain a `createChain` with the same options would collapse onto" — that only holds if both sides break ties identically. Adding `, j.id DESC` to all four ORDER BYs is cheap and makes the contract literally true.

**3. Adding a required method to `StateAdapter` breaks custom adapters, and the changeset doesn't say so.**
`packages/core/src/state-adapter/state-adapter.ts:81-93` adds `getChainsByDeduplication` as a non-optional member. `docs/src/content/docs/advanced/adapters.md` documents writing your own adapter, so this is a compile break for anyone who has. The release is already `major` overall via `job-model-v2`, so the bump level is fine, but `.changeset/reads-by-deduplication.md` should carry a bullet: custom `StateAdapter` implementations must implement `getChainsByDeduplication`.

**4. `getChain` is missing the "neither `id` nor `deduplication`" guard its sibling has.**
`packages/core/src/client.ts:1069-1082` throws for *both*, but a JS caller passing neither falls through to `ids: [id!]` → `ids: [undefined]`, which reaches the adapter and quietly returns `undefined` instead of erroring. `getChains` has the symmetric `"requires either ids or deduplications"` check. Add the same one to `getChain` (or delegate the whole validation to `getChains` by not synthesising `ids`).

**5. None of the four new runtime guards are tested.**
`"…not both"` (×2), `"requires either ids or deduplications"`, `"requires a typeName"` — grep finds no test referencing any of them. They're the JS-caller backstop for a compile-time union, which is exactly the case types don't cover. The `lock: true` backstops next to them *are* tested in `packages/core/src/suites/client-queries.test-suite.ts`; these should be too.

**6. Two lock sites in the PG locked query, with unclear precedence.**
The locked variant takes `FOR UPDATE` both in `locked_resolved_latest` (ordered `BY j.id`, presumably for deadlock-free lock ordering) and in the tail lateral (`state-adapter.pg.ts:926-946`). They lock the same rows. Whether the ordered CTE actually runs *first* depends on the planner: the CTE is only referenced from a `WHERE EXISTS` in the outer query, which PG may evaluate as a semi-join after the lateral has already locked rows in `resolved` order. If the ordering was the point, this doesn't reliably deliver it; if it wasn't, one of the two lock sites is dead weight. Either way it deserves a comment explaining the intent — a future reader will otherwise assume the `EXISTS` is a real filter (it always matches).

## Suggestions

- `state-adapter.pg.ts:1000-1010`: the `sameRow ? row.tail_job : row.head_job` mapping is a same-row swap that reads as if it were meaningful, and it dereferences `tail_job` on a branch the type system isn't narrowing. The SQLite twin and `alignChainsToIds` both use the straightforward `head_job` + `tailJob && tailJob.id !== headJob.id` shape. Match them.
- `state-adapter.sqlite.ts:462`: `if (lock === "exclusive" && txCtx)` silently degrades to an unlocked read when `txCtx` is absent. It matches the existing `getChains`, so it's consistent — but the type already makes `txCtx` mandatory alongside `lock`, so the `&& txCtx` is a silent-failure branch that can only be reached by a JS caller. A throw would be more honest in both places.
- The `alignJobsToIds`/`alignChainsToIds` extraction (renamed from `classify*`, duplicated per adapter) is a nice cleanup and made the SQLite `getChains`/`getJobs` bodies noticeably shorter. No action — just worth noting the refactor is a real improvement and is correctly behaviour-preserving.
- `TODO.md` picks up an unrelated `[REF] support tslog logger` line in this diff. Harmless, but it isn't part of this change.

## Alternative Approaches

### Alternative 1: resolve-then-lock-then-recheck

**Approach:** After `FOR UPDATE` is granted, re-evaluate the dedup predicate against the now-current rows (a second pass over the locked chains, discarding any that left scope) — either as an extra CTE in the same statement or a second statement in the same transaction.
**Trade-offs:**

- Pro: closes Concern 1; `lock: true` then means what the docs say, and the returned chain is genuinely alive at lock time.
- Pro: makes the read path *stronger* than the create path, which is the direction #3 wants to move anyway.
- Con: a second scan, and it still can't stop a *new* same-key chain appearing (only the `dedup_lock` table from `design/concurrent-deduplication.md` does that), so it's a partial fix that may invite over-trust.
- Con: SQLite gets it for free (serialized), so this is PG-only complexity.

**When to prefer:** if keyed-singleton scheduling is going to be the marketed use case, this is the honest floor. Otherwise, document the caveat (cheaper, and the create-side fix subsumes it).

### Alternative 2: one adapter method, discriminated selector

**Approach:** instead of `getChainsByDeduplication` alongside `getChains`, a single `getChains({ by: { kind: "ids", ids } | { kind: "deduplication", chainTypeName, deduplications } })`.
**Trade-offs:**

- Pro: one method to implement for custom adapters instead of two; the shared tail-lateral/tail-join and row-alignment logic lives in one place naturally.
- Pro: the client's four-way `deduplications ? (lock ? … : …) : (lock ? … : …)` nest (`client.ts:1108-1131`) collapses.
- Con: breaks *every* adapter's `getChains` signature rather than adding one method — worse migration for the same release.
- Con: the two lookups genuinely have different index and locking shapes; merging them makes the SQL builders branchier, not simpler.

**When to prefer:** if a third lookup form ever arrives. For two, the current split is the right call.

### Alternative 3: expose it as `resolveDeduplication(key) → chainId`

**Approach:** a narrow method returning only the resolved id, with the caller chaining into the existing `getChain({ id, lock })`.
**Trade-offs:**

- Pro: much smaller adapter surface; no new locking SQL at all.
- Con: two round trips, and the resolve/lock gap in Concern 1 becomes *wider* and fully caller-visible.
- Con: loses the batch-positional guarantee that `getChains` gives.

**When to prefer:** not here — the current design is better. Recorded so the trade-off is explicit.

## Questions

1. Concern 6 — was `locked_resolved_latest`'s `ORDER BY j.id FOR UPDATE` added for deadlock-free lock ordering? If so, is there a reason to believe it executes before the lateral's `FOR UPDATE`?
2. Concern 1 — is the stale-scope-after-lock window a known, accepted consequence of #3 (in which case: docs sentence), or was `lock: true` intended to make the by-dedup read race-free?
3. Concern 2 — deliberate that neither create nor read tie-breaks on `id`, or just never came up because ties are rare outside same-transaction creates?
4. `getChains({ deduplications: [] })` throws `"requires a typeName"` when `typeName` is omitted, whereas `getChains({ ids: [] })` short-circuits to `[]`. Intentional strictness, or should the empty-input short-circuit come first for symmetry?
