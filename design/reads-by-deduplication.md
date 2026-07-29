# Reads by deduplication key

Let `getChain` / `getChains` resolve a chain by its deduplication key, not only by id, so code
that created a chain with a dedup key can find it again without having persisted the id.

## Problem

`getChain` / `getChains` look up by `id` / `ids`. The only other stable handle a chain has is its
deduplication key, and there is no way to read by it. Deduplication already indexes the key —
`createChain` matches on it to collapse duplicates — but that lookup is buried inside `createJobs`
and is not exposed.

The driver is the keyed-singleton-chain pattern (see [builtin-cleanup.md](builtin-cleanup.md)): a
scheduler creates one chain per key with `deduplication: { key, scope: "running" }`, and later
needs to find "the alive chain for key K" to reconfigure or cancel it — having kept nothing but
the key (and the chain type). More generally, any caller that owns a stable dedup key but not the
generated id needs this.

## Solution

Add a deduplication discriminant to `getChain` / `getChains`, alongside the existing id-based
forms. The `deduplication` value is always the **full `DeduplicationOptions`** — the exact type
`createChain` accepts:

```ts
// existing (by id)
client.getChain({ ...txCtx, id });
client.getChains({ ...txCtx, ids });

// new (by deduplication)
client.getChain({ ...txCtx, typeName, deduplication }); // the one resolved chain, or undefined
client.getChains({ ...txCtx, typeName, deduplications }); // one resolved chain per entry, positional
```

### Resolves the chain a write would collapse onto

The read resolves **the single chain a `createChain` with the same options would deduplicate
onto** — the newest chain in scope. This is not a filter that might return many; it is the exact
counterpart of the write-side resolution.

- **`getChain({ typeName, deduplication })`** → `Chain | undefined`. Exactly the chain a
  `createChain` of that type with the same options would collapse into, or `undefined` if it would
  instead create fresh. The point lookup.
- **`getChains({ typeName, deduplications })`** → positional `(Chain | undefined)[]`, one resolved
  chain per `DeduplicationOptions` entry, aligned to input order — the batch form, mirroring
  `getChains({ ids })`. Each entry resolves to at most one chain, just as each id does.

Because the read resolves to the same single chain the write side would, a lookup and the create
it mirrors can never diverge: `scope` (`"running" | "any"`), `windowMs`, and `excludeChainIds` all
carry the same meaning they have on `createChain`, and "newest in scope" is exactly
`createChain`'s own tie-break when several match. Nothing throws — `scope: "any"` over a recurring
key resolves to the latest occurrence, and reading the whole recurrence history is a separate,
deferred concern (see [list-chains-by-deduplication.md](list-chains-by-deduplication.md)).

### `typeName` is required and scopes the match

Deduplication on the write side is **scoped per chain type**: a `createChain` of type `X` with key
`K` only ever collapses onto existing type-`X` chains with key `K`. So the key alone does not
identify a chain — the `(chainType, key)` pair does. The read therefore takes a **required
`typeName`** that participates in the match, precisely mirroring the write.

This is why `typeName` behaves differently here than on the id-based forms:

- **By id** — an id already identifies one chain globally and uniquely. `typeName` is optional and
  only _asserts_ the resolved chain's type (throwing `ChainTypeMismatchError` on mismatch) and
  narrows the return type; filtering by type would be redundant.
- **By deduplication** — the key is unique only within a chain type, so `typeName` is a genuine
  part of the lookup: required, and scoping the match. It narrows the return type as a bonus.

`scope` is likewise required (it is on `DeduplicationOptions`), so the caller always states both
the chain type and the scope — the same two things a `createChain` states.

### Scope drives how much is visible, not the cardinality of the resolve

- **`"running"`** (alive: pending or running) — deduplication guarantees at most one chain per key
  per type is alive at a time, so the resolve is the alive chain or `undefined`.
- **`"any"`** — includes completed chains; a key can recur across many completed chains over time.
  The read still resolves to the single newest match (what a write would collapse onto). Paging
  through the full history is deferred to
  [list-chains-by-deduplication.md](list-chains-by-deduplication.md).

### Index

Both the read and the write match on `deduplication_key` **and** `chain_type_name`, then order by
`created_at DESC`. Today's `job_deduplication_idx` is `(deduplication_key, created_at DESC) WHERE
deduplication_key IS NOT NULL AND chain_index = 0` — it leads with the key and leaves
`chain_type_name` as a heap residual, so the newest-first walk can step over wrong-type rows before
finding the match. Tighten it to include the type as a second seek column:

```
job_deduplication_idx ON (deduplication_key, chain_type_name, created_at DESC)
  WHERE deduplication_key IS NOT NULL AND chain_index = 0
```

Key-first (not `chain_type_name`-first): `deduplication_key` is the selective, identifying column,
and a `(deduplication_key, created_at DESC)` prefix stays usable for key-only lookups (the deferred
[list-chains-by-deduplication.md](list-chains-by-deduplication.md) history query). A type-led index
would only expose a `(chain_type_name, …)` prefix over dedup-keyed roots, which is not a useful
standalone path and duplicates the existing type-listing indexes.

This is a schema change on both SQL adapters. Each has a migration framework: keep the historical
`20240101` definition untouched and add a new migration that drops and recreates the index tightened
— PostgreSQL with `DROP INDEX CONCURRENTLY` (matching its other index-only migrations), SQLite with
`DROP INDEX IF EXISTS` + `CREATE INDEX`. It executes on user DBs, so it needs a changeset.

The in-process index is already keyed by `${chainTypeName}\0${key}`, so
`findDeduplicatedJob(chainTypeName, deduplication)` resolves newest-in-scope per type and is reused
verbatim — no in-process change. Confirm the SQL index against
[postgres-internals](../docs/src/content/docs/advanced/postgres-internals.md) and
[sqlite-internals](../docs/src/content/docs/advanced/sqlite-internals.md) (both list the index and
must be updated) before implementing.

### Surface

- **Client** —
  - `getChain` options: `{ id; typeName? }` **or** `{ typeName; deduplication: DeduplicationOptions }`.
  - `getChains` options: `{ ids; typeName? }` **or** `{ typeName; deduplications: DeduplicationOptions[] }`.
- **`StateAdapter`** — `getChains` gains a by-deduplication lookup variant carrying the chain type
  and an array of `DeduplicationOptions`, resolving one root per entry (positional) through the
  same query path as id lookup.
- **Adapters** — PostgreSQL, SQLite, in-process implement the variant. In-process and SQLite reuse
  the existing per-entry `findDeduplicatedJob` resolution; PostgreSQL batches it (the
  `existing_deduplicated` CTE `createChains` already uses picks newest-per-ordinal).

### Lock

`getChain` / `getChains` compose with `lock` ([reads-with-lock.md](reads-with-lock.md)):
`getChain({ typeName, deduplication, lock: true })` — resolve the alive chain by key and lock it —
is the exact primitive the cleanup scheduler uses for its compare-and-swap. The lock lands on the
resolved chain's latest job, identical to the id-based locked read.

### Chains only

Deduplication is a chain-root concept, so this covers chains. `getJob` / `getJobs` do not gain a
deduplication lookup; if a job-level need appears later it is a separate, additive change.

## Dependencies

Independent of [reads-with-lock.md](reads-with-lock.md), but composes with it:
`getChain({ typeName, deduplication, lock: true })` is the primitive the cleanup scheduler builds
on. The unbounded recurrence-history listing is tracked separately in
[list-chains-by-deduplication.md](list-chains-by-deduplication.md).

## Tests

- `getChain` by key resolves the newest in-scope chain of the given type; returns `undefined` when
  none is in scope.
- Once the chain completes, `scope: "running"` returns `undefined` while `scope: "any"` still
  resolves it (the newest occurrence).
- `getChains({ deduplications })` resolves one chain per entry, positional, `undefined` for entries
  with no in-scope match.
- The same key under a different chain type is not matched (type scoping).
- `windowMs` and `excludeChainIds` on a read narrow the match exactly as they do on `createChain`.
- Composed with `lock`: a by-deduplication read locks the resolved row.
  </content>
