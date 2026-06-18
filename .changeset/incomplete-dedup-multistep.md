---
"@queuert/core": patch
"@queuert/postgres": patch
"@queuert/sqlite": patch
---

Fixed `"incomplete"` deduplication scope to correctly match multi-step chains that have continued past the root job. Previously, the lookup checked the root job's status directly — once the root completed (to continue to step 2), the chain was no longer matched, even though it was still running. The fix checks whether the chain's last job is completed instead.
