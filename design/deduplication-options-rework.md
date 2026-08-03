# Deduplication options rework

> **Superseded by [chain-identity.md](chain-identity.md).** Its `excludeChainIds` diagnosis and the
> post-completion scheduling fix are folded in there. Kept for the reasoning only.

Shrink `DeduplicationOptions` to what deduplication actually is. Two axes carry their weight
(`key`, `scope`); the third exists to work around a problem elsewhere.

## Problem

`DeduplicationOptions` has three fields, and only the first two describe deduplication:

- **`key`, `scope`** — the real thing. Singleton (`running`) and once-ever (`any`) are distinct
  needs, neither expressible via the other. Keep as-is.
- **`excludeChainIds`** — a workaround for completion-callback ordering, see below.

The cost is not just the write path. The extra field propagates: `getChain`/`getChains` now accept
the full options (see [reads-by-deduplication](../.changeset/reads-by-deduplication.md)), and
[list-chains-by-deduplication.md](list-chains-by-deduplication.md) is blocked largely on deciding
what it means as a read filter — `excludeChainIds` has no clear meaning in a listing at all.

### `excludeChainIds` — caused by callback ordering, not by deduplication

The recurring-chain pattern is important and must keep working: a chain's last job self-schedules
the next occurrence under a stable key with `scope: "running"`, so a manual trigger during the
run collapses onto the in-flight chain instead of forking a second recurrence.

It needs `excludeChainIds: [job.chainId]` only because of _when_ the user code runs. In
`job-process.ts`, the complete callback is invoked (line ~591) **before** `finishJob` writes the
completion (line ~625). So a `createChain` issued from inside the callback runs against a snapshot
where the current chain's terminal job still has `completed_at IS NULL` — the chain matches its own
`scope: "running"` lookup, and the create deduplicates onto the chain that is completing.

Nothing about this is inherent. If the same `createChain` ran **after** the completion write but
**within the same transaction**, it would see its own transaction's write, the terminal job would
be complete, and `scope: "running"` would correctly not match. No exclusion parameter needed.

The blocker is only that no `txCtx` / `transactionHooks` is exposed after `complete()` resolves.

## Approach

**Post-completion, same-transaction scheduling.** Give the handler a way to run work after the
completion write inside the completion transaction, then drop `excludeChainIds`. Two candidate
shapes:

- Extend `execute` to be valid after `complete()`, reusing the completion transaction rather than
  opening a fresh guarded one (today it is documented as staged-mode-only, between `prepare` and
  `complete`):

  ```ts
  const output = await complete(async () => ({ ... }));
  await execute(async ({ transactionHooks, ...txCtx }) => {
    await client.createChain({ ...txCtx, transactionHooks, deduplication: { key, scope: "running" } });
  });
  return output;
  ```

- Or an explicit after-completion callback on `complete` itself, which keeps the "one transaction,
  one call" shape but adds a second callback parameter.

Either way the recurrence stays atomic with the completion — a crash rolls back both.

## Open questions

- Is post-`complete` `execute` acceptable, or does reusing the completion transaction break the
  guarded-transaction invariants `execute` relies on today?
- Does the same ordering problem affect `continueWith`-based recurrence, or only `createChain`?
- Removing `excludeChainIds` is breaking (`major`). Is a deprecation window worth it, or does it
  ride along with other breaking dedup work?

## Surface

- **Core** — `DeduplicationOptions` loses `excludeChainIds`; handler gains post-completion
  transactional scheduling.
- **Adapters** — PostgreSQL, SQLite, in-process drop the exclusion param and its SQL clause.
- **Docs / examples** — `showcase-scheduling`, `showcase-cleanup`, deduplication and scheduling
  guides move to the new pattern.

## Dependencies

Unblocks [list-chains-by-deduplication.md](list-chains-by-deduplication.md) — its unresolved filter
question is about this field.

Interacts with [concurrent-deduplication.md](concurrent-deduplication.md). The matching predicate
being conditional — `scope`, and today `excludeChainIds` — is why a unique index cannot enforce
deduplication and why that fix has to be a lock. Dropping the field here narrows the predicate but
does not remove the conditionality (`scope: "running"` alone keeps it), so the two are independent;
the ordering only matters for how much of the predicate the lock must cover.
