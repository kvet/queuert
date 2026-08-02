---
"queuert": minor
"@queuert/postgres": minor
"@queuert/sqlite": minor
---

`getChain` and `getChains` can now look chains up by deduplication, not just by id. Pass a required `typeName` plus `deduplication` (or `deduplications` for the batch form) and the read resolves the single chain a `createChain` with the same options would deduplicate onto — the newest match in scope — or `undefined` when that create would start a fresh chain instead. This lets code that owns a stable deduplication key find its chain again without having persisted the generated id.

- `client.getChain({ typeName, deduplication })` returns the resolved chain or `undefined`; `client.getChains({ typeName, deduplications })` returns one resolved chain per entry, positionally.
- `typeName` is required for these forms and scopes the match, mirroring `createChain` — a key identifies a chain only within its chain type. `scope`, `windowMs`, and `excludeChainIds` carry the same meaning they have on `createChain`.
- Composes with `lock: true`: resolving the alive chain for a key and locking it in one step is the primitive for keyed-singleton schedulers.
