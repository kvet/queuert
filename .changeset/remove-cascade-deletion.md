---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/dashboard": major
---

Remove the `cascade` option from `deleteChains` and `deleteChain`. Cascade deletion, which expanded the requested chains to include the blocker chains they transitively depend on, is no longer supported: callers that relied on `cascade: true` must enumerate the chains to delete explicitly. Collect a chain's blocker chains with `getJobBlockers` and pass them in the same `deleteChains` call as the chain that depends on them (or delete the dependent chain first); deleting a chain that is still a blocker for a job outside the deleted set fails with `BlockerReferenceError` and deletes nothing.

- `deleteChains({ cascade })` and `deleteChain({ cascade })` are no longer accepted.
- The dashboard's delete dialog loses its cascade checkbox and `DELETE /api/chains/:id` no longer honors `?cascade=true`.
