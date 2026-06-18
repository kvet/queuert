---
"queuert": minor
---

Add batched `client.getChains()` and `client.getJobs()` methods that fetch multiple chains or jobs in a single round trip. Both return a positional array aligned with the input `ids` — `undefined` for any ID that does not exist. The optional `typeName` parameter narrows the return type and validates all found entries. Introduce `ChainTypeMismatchError` for chain type mismatches (previously `JobTypeMismatchError` was used for both chains and jobs); `JobTypeMismatchError` is now reserved for job-only contexts.
