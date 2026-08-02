# List chains by deduplication key

Let `listChains` filter by deduplication key, so a caller can page through **every** chain that
carried a key — the full recurrence history — not just the single chain a write would collapse
onto.

## Problem

[reads-by-deduplication.md](reads-by-deduplication.md) gives `getChain` / `getChains` a
deduplication lookup that resolves the **one** chain a `createChain` would deduplicate onto (the
newest in scope). That is the point lookup. It deliberately does **not** answer "show me all the
chains that ever ran under key `K`" — with `scope: "any"` a recurring key accumulates completed
chains without bound, which is a paginated query, not a get.

`listChains` is the natural home for that: it already paginates and filters by type, status, and
time. It just has no deduplication-key filter yet.

## Why this is split out

The filter does not compose cleanly with `listChains`'s existing shape, and those questions need
resolving before implementation:

- **`scope` vs. `status`.** `DeduplicationOptions.scope` (`"running" | "any"`) encodes an
  alive-vs-all axis that `listChains`'s own `status` (`running` / `completed`) already covers.
  Passing the full `DeduplicationOptions` means two overlapping controls. Options: take a **reduced**
  dedup filter (`key` only, maybe `windowMs`) and let `listChains`'s `status` carry the alive/any
  choice; or accept the full options and define precedence.
- **`windowMs` vs. `from` / `to`.** `windowMs` (relative, from "now") overlaps `listChains`'s
  absolute `from` / `to` range. Decide whether both are honored, or `windowMs` is dropped in favor
  of the existing range filter.
- **`excludeChainIds`.** Excluding specific chains is a dedup-write concern (skip the chain that is
  self-scheduling); its meaning in a listing filter is unclear and probably unnecessary.
- **Type scoping.** By-key reads are scoped per chain type (see reads-by-deduplication). `listChains`
  already has a `typeName?` filter, so this likely composes for free — a dedup filter narrows within
  the type(s) already selected.
- **No lock.** Unlike the point reads, `listChains` is a read-only paginated query and gains no
  `lock` — consistent with every other list method.

The likely shape is a reduced `deduplication?: { key: string; ... }` filter that leans on
`listChains`'s existing `status` / `typeName` / `from` / `to` axes rather than re-importing the
full `DeduplicationOptions`, but that is the decision this doc exists to make.

## Surface (tentative)

- **Client** — `listChains` gains an optional deduplication filter (reduced shape TBD).
- **`StateAdapter`** — `listChains` gains the corresponding filter parameter.
- **Adapters** — PostgreSQL, SQLite, in-process implement it, reusing `chain_deduplication_idx`.

## Dependencies

Builds on [reads-by-deduplication.md](reads-by-deduplication.md) (shared matching semantics and
index). Independent of built-in cleanup, which needs only the point lookup.
</content>
