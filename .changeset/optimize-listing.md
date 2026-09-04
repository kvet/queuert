---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

Add `client.listChainTypeNames()` and `client.listJobTypeNames()` for discovering which job and chain types exist in the data. Both return a sorted array of distinct type names present in the store. Add `client.countByChainTypeNames()` and `client.countByJobTypeNames()` for per-status counts of given type names, with a capped count and `hasMore` flag.

**Breaking:** `listChains` and `listJobs` now require a single `typeName` string instead of accepting an optional array, so every listing query is anchored to one type and can use a type-specific index. The `chainId` filter is removed from both methods, and `jobId` and `chainTypeName` are removed from `listJobs` — use `listChainJobs({ chainId })` to read the jobs of a specific chain and `getJob`/`getJobs` to fetch jobs by id.
