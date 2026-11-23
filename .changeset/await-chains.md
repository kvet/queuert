---
"queuert": major
---

`awaitChain` takes one options object, `awaitChain({ chain, timeoutMs, pollIntervalMs?, signal? })`, like `client.applyJobOutcome`, and the new `awaitChains` waits for several chains with one read of the chains still running per poll, returning the completed chains in input order.

- `client.awaitChain(chain, options)` becomes `client.awaitChain({ chain, ...options })`; `chain` is a `ChainRef`, `{ id, typeName? }`, or a chain read or created earlier.
- `client.awaitChains({ chains, timeoutMs, pollIntervalMs?, signal? })` replaces `Promise.all` over `awaitChain`, and throws `WaitChainsTimeoutError`, `ChainsNotFoundError` or `ChainsTypeMismatchError`, listing every offending chain.
