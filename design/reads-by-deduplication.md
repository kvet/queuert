# Reads by deduplication key

Let `getChain` / `getChains` resolve a chain by its deduplication key, not only by id, so code
that created a chain with a dedup key can find it again without having persisted the id.

## Problem

`getChain` / `getChains` look up by `id` / `ids`. The only other handle a chain has is its
deduplication key, and there is no way to read by it. Deduplication already indexes the key —
`createChain` matches on it to collapse duplicates — but that lookup is buried inside `createJobs`
and is not exposed.

The driver is the keyed-singleton-chain pattern (see [builtin-cleanup.md](builtin-cleanup.md)): a
scheduler creates one chain per key with `deduplication: { key, scope: "running" }`, and later
needs to find "the alive chain for key K" to reconfigure or cancel it — having kept nothing but
the key. More generally, any caller that owns a stable dedup key but not the generated id needs
this.

## Solution

Add a deduplication lookup discriminant to `getChain` / `getChains`, alongside the existing
id-based forms:

```ts
// existing
client.getChain({ ...txCtx, id });
client.getChains({ ...txCtx, ids });

// new
client.getChain({ ...txCtx, deduplication: { key, scope, windowMs?, excludeChainIds? } });
client.getChains({ ...txCtx, deduplication: { key, scope, windowMs?, excludeChainIds? } });
```

The `deduplication` field takes the **full `DeduplicationOptions`** — the exact type `createChain`
accepts — not a reduced `{ key, scope }`. This is the point: the read matches precisely what a
write-side dedup would match. `scope` (`"running" | "any"`), `windowMs` (only chains created within
the window), and `excludeChainIds` (skip these chains) all apply with the same meaning they carry
on `createChain`, so a lookup and the create it mirrors can never silently diverge. The lookup
resolves the chain(s) whose root job matches those options.

### Scope drives cardinality

- **`"running"`** (alive: pending or running) — deduplication guarantees at most one chain per key
  is alive at a time, so `getChain` (singular) is well-defined and returns `Chain | undefined`.
- **`"any"`** — includes completed chains, and a key can recur across many completed chains over
  time, so a key may match several. This is `getChains` territory; it returns all matches, newest
  first.

`scope` is required (it is on `DeduplicationOptions`), so the caller always states it. `getChain`
by deduplication targets the single match — natural with `scope: "running"`; `getChains` serves
both scopes. `getChain` with `scope: "any"` that finds more than one match is a programming error
and throws rather than silently picking one.

### Index

The alive-scope lookup rides the same index deduplication matching already relies on (a partial
index on the key over alive rows). `scope: "any"` needs the key indexed over all rows; add or
widen the index as required. Confirm against
[postgres-internals](../docs/src/content/docs/advanced/postgres-internals.md) and
[sqlite-internals](../docs/src/content/docs/advanced/sqlite-internals.md) before implementing.

### Surface

- **Client** — `getChain` / `getChains` options become a discriminated union: `{ id }` /
  `{ ids }` **or** `{ deduplication: DeduplicationOptions }`.
- **`StateAdapter`** — `getChains` gains a by-deduplication lookup variant feeding the same query
  path as id lookup.
- **Adapters** — PostgreSQL, SQLite, in-process implement the variant.

### Chains only

Deduplication is a chain-root concept, so this covers chains. `getJob` / `getJobs` do not gain a
deduplication lookup; if a job-level need appears later it is a separate, additive change.

## Dependencies

Independent of [reads-with-lock.md](reads-with-lock.md), but composes with it:
`getChain({ deduplication, lock: true })` — look up the alive chain by key and lock it — is the
exact primitive the cleanup scheduler uses.

## Tests

- `getChain` by key resolves the alive chain; returns `undefined` when none is alive.
- Once the chain completes, `scope: "running"` returns `undefined` while `getChains` with
  `scope: "any"` still returns it.
- `getChains` by key returns all in-scope matches, newest first.
- `getChain` with `scope: "any"` matching multiple chains throws.
- Composed with `lock`: a by-deduplication read locks the resolved row.
