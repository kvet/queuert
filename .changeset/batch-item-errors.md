---
"queuert": major
---

`createChains` and `applyJobOutcomes` check every item before throwing, and their errors list every offending item instead of the first: a new job by its position in `items`, a blocker by its chain id. When items fail with different kinds of errors, the error lists the items of the first kind. `createChain`, the client's `applyJobOutcome` and an attempt handler's `applyJobOutcome` still throw the single-item errors.

- Renamed `BlockerLimitExceededError` to `JobBlockerLimitExceededError`, pairing it with the batch `JobsBlockerLimitExceededError`.
- Added `InvalidJobIdsError`, `JobsBlockerLimitExceededError`, `JobsTypeValidationError` and `UnknownJobTypesError`, each with the `itemIndexes` of the offending items and their single-item `errors` in the same order.
- Added `ChainsNotFoundError`, thrown when blocker chains do not exist; a blocker whose `typeName` differs from the stored chain's throws `ChainsTypeMismatchError`, listing every such blocker.
- Blocker references are typed as the exported `ChainRef`, `{ id, typeName? }`, and `JobRef` is exported.
