---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/dashboard": major
---

Anchor every listing query to a single type so it can use a type-specific index, and add type discovery so callers (and the dashboard) can find which types to list. `listChains` and `listJobs` now require a single `typeName` string instead of accepting an optional array.

- Add `client.listChainTypeNames()` and `client.listJobTypeNames()`, which return a sorted array of the distinct chain and job type names present in the store.
- Add `client.countByChainTypeNames()` and `client.countByJobTypeNames()` for per-status counts of the given type names, each capped with a `hasMore` flag.
- **Breaking:** `listChains` and `listJobs` require `typeName: string`; the `chainId` and `jobId` filters are removed from both, and `chainTypeName` is removed from `listJobs` — use `listChainJobs({ chainId })` to read the jobs of a specific chain and `getJob`/`getJobs` to fetch jobs by id.
