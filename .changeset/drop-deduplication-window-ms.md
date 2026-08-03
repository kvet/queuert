---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

Remove `windowMs` from `DeduplicationOptions`. It was throttling wearing deduplication's clothes, and lossy throttling at that: a suppressed call reported `deduplicated: true` against a chain that may have completed long ago with different input, so the caller could not tell "already queued" from "dropped". Deduplication now matches on `key` and `scope` alone. There is no replacement — if you need rate limiting, do the time check on your side before calling `createChain`, or use an `any`-scoped key together with a retention policy that deletes old chains. Nothing is persisted for `windowMs`, so no migration is needed.

- `deduplication.windowMs` is no longer accepted by `createChain` / `createChains` (a type error; the option is ignored at runtime).
- The "Time-Windowed Deduplication" section is gone from the deduplication guide, and the `showcase-scheduling` example drops its rate-limiting scenario.
