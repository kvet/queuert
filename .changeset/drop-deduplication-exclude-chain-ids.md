---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

Remove `excludeChainIds` from `DeduplicationOptions`. It existed for exactly one reason: a recurring chain self-scheduling its next occurrence under `scope: "running"` matched the chain it was completing, because the completion write had not happened yet when the handler ran. The attempt finalization rework removes that ordering — `complete()` and `continueWith()` apply their transition inside the finalization transaction — so a `createChain` placed after the terminal action already sees the chain as completed and cannot match it. Move the scheduling call after `complete(...)` and drop the option; nothing is persisted for it, so no migration is needed. Scheduling the next occurrence from a mid-chain job, or before the terminal action, now matches the still-running chain and suppresses the occurrence — use `scope: "any"` or schedule from the terminal job instead.

- `deduplication.excludeChainIds` is no longer accepted by `createChain` / `createChains`.
- `DeduplicationOptions` loses its type parameter — write `DeduplicationOptions`, not `DeduplicationOptions<string>`.
- The "Excluding Chains" section of the deduplication guide is replaced by "Self-Scheduling Recurring Chains", which documents the complete-then-schedule ordering; the cleanup and scheduling guides and the `showcase-scheduling` / `showcase-cleanup` examples follow the same shape.
