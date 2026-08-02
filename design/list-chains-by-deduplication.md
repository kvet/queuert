# List chains by deduplication key

Let `listChains` filter by deduplication key, so a caller can page through **every** chain that
carried a key — the full recurrence history — not just the single chain a write would collapse
onto.

## Problem

[chain-identity.md](chain-identity.md) gives `getChain` / `getChains` a by-identity lookup that
resolves the **one** chain a `createChain` would collapse onto. That is the point lookup. It
deliberately does **not** answer "show me all the chains that ever ran under key `K`" — a
`running`-scoped key accumulates completed chains without bound as its recurrence repeats, which is
a paginated query, not a get.

`listChains` is the natural home for that: it already paginates and filters by type, status, and
time. It just has no key filter yet.

## Why this was split out — and what remains

The filter did not compose cleanly with `listChains`'s existing shape. Under
[chain-identity.md](chain-identity.md) all four blockers resolve:

- **`scope` vs. `status`.** Resolved. `scope` is now persisted on the chain, so it partitions rows
  rather than filtering them — it says _which key namespace_ a row belongs to, not whether the row
  is running. It no longer overlaps `listChains`'s `status`, and the two compose: `identity:
{ key, scope: "running" }` plus `status: "completed"` is "every completed occurrence of this
  recurrence", which is exactly the useful query.
- **`windowMs` vs. `from` / `to`.** Resolved by deletion. `windowMs` is gone; `listChains`'s
  absolute range is the only range filter.
- **`excludeChainIds`.** Resolved by deletion.
- **Type scoping.** Resolved. Keys are globally unique rather than per chain type, so `typeName`
  stays an ordinary independent filter with no special interaction.
- **No lock.** Unchanged — `listChains` is a read-only paginated query and gains no `lock`,
  consistent with every other list method.

What remains is index coverage: the `running`-scope unique index is
`(identity_key) WHERE … identity_scope = 'running' AND chain_completed_at IS NULL`, which by
construction excludes the completed rows this listing is _for_. Paging occurrence history needs
either its own index or a documented scan. That is now the only open question, and it is why this
stays separate from `chain-identity.md`.

## Surface (tentative)

- **Client** — `listChains` gains `identity?: ChainIdentity`.
- **`StateAdapter`** — `listChains` gains the corresponding filter parameter.
- **Adapters** — PostgreSQL, SQLite, in-process implement it, against whatever index the coverage
  question above settles on.

## Dependencies

Builds on [chain-identity.md](chain-identity.md) (shared key semantics and storage). Independent of
built-in cleanup, which needs only the point lookup.
</content>
