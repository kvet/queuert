---
"queuert": major
---

Batch reads narrowed by a type report every mismatched id instead of the first. `getChains` and `getChainTailJobs` throw the new `ChainsTypeMismatchError`, and `getJobs` the new `JobsTypeMismatchError`, each with the ids, expected type names and stored type names of every found entity whose type differs; `getChain`, `getChainTailJob` and `getJob` still throw `ChainTypeMismatchError` and `JobTypeMismatchError`.

- Added `ChainsTypeMismatchError` and `JobsTypeMismatchError`, thrown by `getChains`, `getChainTailJobs` and `getJobs` in place of `ChainTypeMismatchError` and `JobTypeMismatchError`.
