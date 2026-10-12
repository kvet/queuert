---
"queuert": minor
---

Blockers can now be passed by ID, so a chain you only stored the ID of no longer needs a `getChain` round trip before `createChain`, `createChains`, or `continueWith`. Core already loads each blocker chain under lock while creating the job, and it now validates that stored chain instead of trusting the object the caller passed.

- `blockers` accepts `{ id, typeName? }` per slot; full chain objects still work unchanged. When given, `typeName` is checked against the slot at compile time.
- A `typeName` that differs from the stored chain's type throws `ChainTypeMismatchError`.
- The job type's `validateBlockers` now receives the stored chain's `typeName` and `input`, read under lock, rather than the caller-supplied values. It now runs after the blocker chains are loaded and locked, so a missing blocker chain throws `ChainNotFoundError` before blocker validation runs.
- Object literals that list chain fields other than `id` and `typeName` explicitly (e.g. `{ ...chain, input }`) are now rejected by the type checker; pass the chain itself or `{ id }`.
