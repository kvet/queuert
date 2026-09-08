---
title: Chain Deletion
description: Delete chains with blocker safety.
sidebar:
  order: 13
---

Chains can be deleted using `deleteChains` (plural) or `deleteChain` (singular). All jobs in the chain (entry job and continuations) are removed together.

```ts
await withTransactionHooks(async (transactionHooks) =>
  client.deleteChains({
    transactionHooks,
    ids: [chain.id],
  }),
);
```

Use `deleteChain` to target a single chain — it returns the deleted chain or `undefined` if no chain with that ID exists. `deleteChains` silently skips missing IDs and returns the chains that were actually deleted. Both calls are idempotent:

```ts
await withTransactionHooks(async (transactionHooks) =>
  client.deleteChain({
    transactionHooks,
    id: chain.id,
  }),
);
```

If a chain is referenced as a blocker by another chain, deletion is rejected unless both chains are deleted together:

```ts
await withTransactionHooks(async (transactionHooks) =>
  client.deleteChains({ transactionHooks, ids: [blockerChain.id] }),
); // throws

await withTransactionHooks(async (transactionHooks) =>
  client.deleteChains({ transactionHooks, ids: [mainChain.id, blockerChain.id] }),
); // ok
```

## How It Works

### What Gets Deleted

Given a list of `ids`, the operation deletes all jobs in each chain (every job where `job.chainId` matches a provided ID, including root and continuations) and cleans up blocker references pointing at deleted chains from surviving jobs.

### Blocker Safety Check

Before deleting, the system checks whether any external chain depends on the target chains as blockers. "External" means the dependent job's own chain is not in the deletion set. This prevents orphaning blocked chains that would never unblock.

```
Chain A (blocker) --> Chain B (blocked)

deleteChains({ ids: [A] })    // BlockerReferenceError -- B depends on A
deleteChains({ ids: [A, B] }) // Both in deletion set -- no external refs
```
