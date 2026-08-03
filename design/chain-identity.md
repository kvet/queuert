# Chain identity

Replace `DeduplicationOptions` with `identity: { key, scope }`, and persist `scope` on the chain
instead of evaluating it per query. `excludeChainIds` goes away, the read surface stops speaking
write-side vocabulary, and deduplication becomes enforceable by a unique index rather than by a lock.

## Problem

`deduplication` is one name for three unrelated needs, and its option bag is the union of all of
them:

- **Idempotent enqueue** — "this request creates a chain once, ever". The key is an idempotency
  key; the correct scope is `any`. This is what makes `createChain` safe to call from a retried API
  handler with no ambient transaction of its own.
- **Singleton / recurrence** — "at most one chain under this name is running". The key is a name;
  the correct scope is `running`. Recurring chains and "one sync per user in flight" are both this.
- **Correlation lookup** — "find the chain for this external thing". A webhook arrives carrying a
  Stripe id, not a chain id. This one is **not supported at all today**: the key is persisted on the
  root row but `mapStateJobToJob` drops it, so it never reaches the public entity.

Because it is one type, every surface that touches it receives all three fields. Three consequences:

- **The read design inherits write vocabulary.** `reads-by-deduplication.md` gives `getChain` a
  by-deduplication form taking the full `DeduplicationOptions` — so a _read_ accepts
  `excludeChainIds`, which means nothing there, and the guide has to explain it anyway. It also
  needs a required `typeName` that behaves differently from the `typeName` on the by-id form, which
  needs its own paragraph.
- **`list-chains-by-deduplication.md` is blocked** on what `excludeChainIds` means as a listing
  filter — nothing at all.
- **The matching predicate is conditional**, which is why deduplication cannot be enforced by a
  unique index and why `concurrent-deduplication.md` exists.

And only two of the three fields describe deduplication:

- **`key`, `scope`** — the real thing. Keep.
- **`excludeChainIds`** — a workaround for completion-callback ordering. In `job-process.ts` the
  complete callback runs (~line 586) **before** `finishJob` writes the completion (line 625), so a
  `createChain` issued from the callback sees a snapshot where the current chain's terminal job is
  still incomplete. The chain matches its own `scope: "running"` lookup and the recurrence
  deduplicates onto the chain that is completing. Nothing about this is inherent to deduplication.

## Solution

One nested option object, reused verbatim across write and read:

```ts
type ChainIdentity = {
  /** Caller-owned key. Unique within its scope. */
  key: string;
  /** How long the key is held. Persisted on the chain. */
  scope: "any" | "running";
};
```

```ts
client.createChain({ ...txCtx, transactionHooks, typeName, input,
  identity: { key: `sync:user:${userId}`, scope: "running" } });

client.getChain({ identity: { key: `sync:user:${userId}`, scope: "running" } });
client.getChains({ identities: [...] });
client.listChains({ identity: { key, scope: "running" } });
```

A chain has a caller-owned identity. Creating a second chain under a taken identity returns the
holder; looking one up by identity finds it. The write behavior and the read behavior are the same
fact stated twice, which is what `deduplication` never managed to convey.

### `scope` is stored, not evaluated — this is the correctness change

Today `scope` is a **query parameter**: `createChains` runs a `SELECT` whose predicate is built per
call, then inserts what it did not match. Under READ COMMITTED both CTEs of that statement share one
snapshot, so two concurrent same-key creates both match nothing and both insert
([#3](https://github.com/kvet/queuert/issues/3)).

Persisting `scope` on the root row makes the predicate **static**, so the database can enforce it:

```sql
UNIQUE (identity_key) WHERE identity_key IS NOT NULL AND chain_index = 0
                        AND identity_scope = 'any'
UNIQUE (identity_key) WHERE identity_key IS NOT NULL AND chain_index = 0
                        AND identity_scope = 'running' AND chain_completed_at IS NULL
```

Both are static partial unique indexes. `scope` on a **read** is then not a snapshot predicate
either — it selects which index to probe. Two rows may share a key across scopes without ambiguity,
because every read names the scope it means.

This retires `concurrent-deduplication.md` in full. That document's entire option space — bucketed
advisory locks vs. a `dedup_lock` table, the vacuum debt, the unverified speculative-insertion
assumption, the REPEATABLE READ caveat — exists only because "the matching predicate is
conditional". It stops being conditional. The create path becomes an insert that conflicts, and
deduplicating (not creating) costs one extra read of the winning row.

### Reads: resolve versus history

At most one row can match a `(key, scope)` pair, so a by-identity read is a genuine point lookup.
The "resolve the chain a `createChain` would collapse onto — the newest match in scope" framing
disappears, along with its `ORDER BY created_at DESC`:

| scope       | `getChain({ identity })`          | `listChains({ identity })`     |
| ----------- | --------------------------------- | ------------------------------ |
| `"any"`     | the one chain, ever               | — (there is only one)          |
| `"running"` | the running chain, or `undefined` | every occurrence, newest first |

Completed `running`-scoped chains keep their key — that is precisely what frees it for the next
occurrence — so they accumulate, and paging them is meaningful. `any`-scoped keys are globally
unique, so listing one returns 0 or 1 row and `getChain` already covers it. This resolves both open
questions in [list-chains-by-deduplication.md](list-chains-by-deduplication.md).

`typeName` is **optional** on the by-identity read, exactly as on the by-id read: the key is unique
globally rather than per chain type, so it identifies a chain on its own and `typeName` merely
asserts and narrows (throwing `ChainTypeMismatchError` on mismatch). `reads-by-deduplication.md`
instead makes it required and part of the match, which is correct under per-type keys but forces the
docs to explain why the same parameter behaves differently on two forms of one method. Global keys
remove the asymmetry.

These reads compose with `lock: true` (shipped): resolving the running chain for a key and locking
it in one step is the primitive behind keyed-singleton schedulers.

Keys are already namespaced in practice (`__queuert/cleanup:main`, `stripe:pi_…`), and a bare key
colliding across chain types is far more likely a bug than an intent.

### `excludeChainIds` needs the ordering fix first — it is a prerequisite, not a cleanup

With a real unique index, the self-scheduling create in a complete callback stops deduplicating onto
the completing chain **silently** and starts violating a constraint. The workaround cannot survive
contact with the index, so it cannot simply be deleted — the ordering has to be fixed first.

[attempt-finalization-rework.md](attempt-finalization-rework.md) already supplies exactly this.
Under `finalize`, `complete(output)` applies the transition **inline**, so code after it runs in the
same transaction with the completion write already visible:

```ts
return finalize(async ({ complete, transactionHooks, ...txCtx }) => {
  const terminal = await complete(output);

  await client.createChain({
    ...txCtx,
    transactionHooks,
    typeName,
    input,
    schedule: { afterMs: intervalMs },
    identity: { key, scope: "running" },
  });

  return terminal;
});
```

The completing chain's root already carries `chain_completed_at`, the partial index no longer covers
it, and the insert is clean. The recurrence stays atomic with the completion — a crash rolls back
both.

**Ordering:** `finalize` lands before the unique indexes, not alongside them. Both are breaking, so
they can share a major; they cannot be reordered.

### Recurrence stays imperative

A first-class `recurrence: { intervalMs }` on the chain was considered and rejected. It buys one
deleted field and hands back a whole method family — `rescheduleRecurrence`, `cancelRecurrence`,
`reconfigureRecurrence` — plus it takes the per-run decision away from the handler, which today
decides whether to continue at all (`showcase-scheduling` does exactly that).

With the ordering fix, imperative recurrence needs nothing from the library:

- **schedule the next run** — `createChain({ schedule: { afterMs }, identity })` after `complete()`
  inside `finalize`
- **stop** — do not create the next one
- **cancel from outside** — `getChain({ identity })` then `deleteChain`
- **reconfigure without resetting the timer** — `getChain({ identity, lock: true })`, compare,
  `deleteChain` + `createChain` in one transaction

History is unaffected: each occurrence is its own chain, completed occurrences persist, and
reconfiguration touches only the current pending one.

A `schedule` table (`name`, `next_run_at`, `interval`, `current_chain_id`) with cron-like
management remains available later if users ask for it. Nothing here forecloses it.

### `id` versus `identity`

Two nearby words on the same call with opposite collision behavior. The contrast is worth stating
explicitly in the guide, and it should land alongside
[caller-supplied-id-collisions.md](caller-supplied-id-collisions.md), whose whole premise is the
first half of it:

> `id` assigns the chain's row identity — a collision is an error (`DuplicateJobIdError`).
> `identity.key` is your identity for the work — a collision returns the existing chain.

### `deduplicated` becomes `created`

`deduplicated: true` no longer describes what happened: for `scope: "any"` it means "already
enqueued", for `scope: "running"` it means "already running". `created: false` is accurate for both
and reads correctly at the call site (`if (!created) return existing`).

## Schema

Rename and add on the `job` table:

- `deduplication_key` → `identity_key TEXT NULL` (meaningful only on `chain_index = 0`)
- **new** `identity_scope TEXT NULL` — `'any' | 'running'`, non-null exactly when `identity_key` is
- **new** `chain_completed_at TIMESTAMPTZ NULL` on the root row — denormalized chain completion

`chain_completed_at` is the one genuinely new invariant. Chain completion is derived today from the
**terminal** job (`completed_at IS NOT NULL AND continued_to_id IS NULL`, see
`entities/chain.ts:deriveStatus`), but a partial index on the root needs it **on the root**.
`finishJob` already reads the head job in its `!hasContinuedJob` branch, so the write slots in there
naturally; it must happen in the same transaction as `finishJobAttempt`. `continueWith` does not set
it — the chain is not complete — which matches `deriveStatus` exactly. Deleting a chain removes the
row and frees the key.

`job_deduplication_idx` — today `(deduplication_key, created_at DESC) WHERE deduplication_key IS NOT
NULL AND chain_index = 0` — is replaced by the two unique indexes above. Its `created_at DESC`
tail-breaker exists only to pick "newest in scope", which no longer has a meaning. Both internals
docs list it and must be updated.

**PostgreSQL** (`20260802000000_chain_identity`) — column rename + adds, backfill `identity_scope`
and `chain_completed_at` for existing rows, `CREATE UNIQUE INDEX CONCURRENTLY` for both (matching the
adapter's other index-only migrations). Backfill must precede index creation or existing duplicates
abort it — see Open questions.

**SQLite** — same shape; `ALTER TABLE ... RENAME COLUMN` + `ADD COLUMN`, `DROP INDEX IF EXISTS` +
`CREATE UNIQUE INDEX`.

**In-process** — `idx.findDeduplicatedJob` collapses to a map keyed by `${scope}\0${key}`, with the
`running` map keyed only on live chains.

## Surface

- **Core** — `DeduplicationOptions` → `ChainIdentity` (`excludeChainIds` dropped);
  `createChain`/`createChains` take `identity` and return `created`; `getChain`/`getChains` gain an
  `identity`/`identities` form with optional `typeName`; `listChains` gains `identity`;
  `identityKey`/`identityScope` reach the public `Chain`/`Job` entities and the dashboard job
  detail (closing the "expose the dedup key to the dashboard" task).
- **`StateAdapter`** — a new `getChainsByIdentity` taking `ChainIdentity[]` and no chain type,
  resolving one root per entry positionally. Because each entry can match at most one row, it is a
  plain keyed lookup — no `unnest … WITH ORDINALITY`, no `DISTINCT ON (ord)`, no per-entry window
  or exclusion arrays, none of which `reads-by-deduplication.md` could avoid. SQLite's locked
  variant correspondingly does not have to duplicate a resolve subquery, which is one of the two
  complaints in [sqlite-write-promotion.md](sqlite-write-promotion.md).
- **Adapters** — schema above; `createChains` drops the `existing_deduplicated` CTE in favour of
  conflict handling; the deduplication predicate leaves the SQL entirely.
- **Docs** — `guides/deduplication.md` becomes `guides/chain-identity.md` (the three uses, the two
  scopes, the read forms, the `id` contrast); `guides/queries.md`, `advanced/adapters.md`, both
  internals docs, README / index / introduction feature bullets.
- **Examples** — `showcase-scheduling`, `showcase-cleanup` (both drop `excludeChainIds` and move to
  post-completion scheduling), `showcase-queries` (identity lookup scenario).

## Dependencies

- **Requires** [attempt-finalization-rework.md](attempt-finalization-rework.md) — `finalize` is what
  makes the completion write visible to post-completion scheduling, without which `excludeChainIds`
  cannot be removed and the `running`-scope unique index cannot hold.
- **Supersedes** `deduplication-options-rework.md` — its `excludeChainIds` diagnosis is folded in
  above, and its two candidate shapes are already superseded by `finalize`.
- **Supersedes** `reads-by-deduplication.md` — the by-identity read is part of this design, with a
  global key and an optional `typeName` instead of a per-type key and a required one. That work was
  implemented once and reverted; this is the shape to build instead.
- **Retires** `concurrent-deduplication.md` — the unique indexes close
  [#3](https://github.com/kvet/queuert/issues/3); its lock-based options are no longer needed.
- **Unblocks** [list-chains-by-deduplication.md](list-chains-by-deduplication.md) — both of its open
  filter questions were about the two removed fields.
- **Simplifies** [builtin-cleanup.md](builtin-cleanup.md) — `scheduleCleanup`'s read-compare-swap
  keeps its shape but loses the absent-row race (the unique index catches it), and the handler's
  self-reschedule loses `excludeChainIds`.
- **Pairs with** [caller-supplied-id-collisions.md](caller-supplied-id-collisions.md), and not only
  for the `id` vs `identity` documentation. Rewriting the create path around `ON CONFLICT` on the
  identity index removes the `ON CONFLICT (chain_id, chain_index)` clause that currently swallows a
  colliding caller-supplied `id` — a PostgreSQL `ON CONFLICT` targets one constraint. Without that
  item's JS-side detection, an id collision would start raising a raw `23505` and aborting the
  caller's transaction, which is the exact failure mode it exists to prevent. Land it with or before
  the create-path rewrite; note its PostgreSQL approach (`(xmax = 0) AS inserted` on the
  `inserted_jobs` CTE) is written against today's SQL and needs re-deriving against the new shape.
- **Timing.** The whole of this is breaking (`major`). The current major line is unreleased, so
  landing it before release costs one changeset; landing it after costs another major. That is the
  argument for doing it now rather than shipping the by-deduplication read first and reshaping it
  later.

## Tests

- `identity` with `scope: "any"` returns the existing chain forever; with `scope: "running"` returns
  it while running and creates fresh once completed.
- Two concurrent `createChain` calls with the same `(key, scope)` yield exactly one chain and one
  `created: true` — gated on `transactionConcurrency !== "serialized"`, and failing against
  PostgreSQL before the indexes land.
- The same key under both scopes coexists; each read resolves its own scope.
- `getChain({ identity })` is `undefined` when nothing is in scope; `typeName` narrows and throws
  `ChainTypeMismatchError` on mismatch.
- `listChains({ identity })` pages every occurrence of a `running`-scoped key, newest first.
- A recurring chain self-schedules from after the completion write with no exclusion parameter, and
  does not deduplicate onto itself.
- `chain_completed_at` is set exactly when the chain completes, not on `continueWith`, and rolls
  back with the transaction.
- Deleting a chain frees its key for reuse under both scopes.
- Index coverage cases for both unique indexes.

## Open questions

- **Backfill of existing duplicates.** A user's live database may already hold two chains that
  violate either new index (that is [#3](https://github.com/kvet/queuert/issues/3) having fired).
  `CREATE UNIQUE INDEX` will abort. Decide between failing the migration with a diagnostic query,
  keeping the newest and clearing the losers' keys, or shipping a pre-migration check. This is the main migration risk.
- **Is post-`complete` `execute` acceptable**, or does reusing the completion transaction break the
  guarded-transaction invariants `execute` relies on today?
- **Does `continueWith`-based recurrence hit the same ordering problem**, or only `createChain`?
- **`created` vs keeping `deduplicated`** — the rename is right but adds surface to the migration
  guide on top of everything else here.
