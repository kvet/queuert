---
"queuert": minor
---

The client can read the job a chain is currently on for a whole batch of chains in a single state adapter read, instead of one `listChainJobs` call per chain ([#9](https://github.com/kvet/queuert/issues/9)). Both new methods are experimental and may change in a minor release.

- `client.getChainTailJobs({ chainIds, chainTypeName? })` returns each chain's tail job (its latest job in chain order, or the head job while the chain has not continued), aligned with `chainIds` and `undefined` for a missing chain.
- `client.getChainTailJob({ chainId, chainTypeName? })` returns the tail job of one chain.
- Both throw `ChainTypeMismatchError` when `chainTypeName` is given and a found chain has another type.
