---
title: Chain Deletion
description: Delete chains with blocker safety.
sidebar:
  order: 13
---

Chains can be deleted using `deleteChains` (plural) or `deleteChain` (singular). All jobs in the chain (its head job and continuations) are removed together.

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

## Deleting a Chain with Its Blockers

Deletion never follows blocker relationships on its own. To remove a chain together with the chains it waits on, collect its blocker chains with `getJobBlockers` and pass them in the same `deleteChains` call:

```ts
const blockerChains = await client.getJobBlockers({ jobId: reportChain.id });

await withTransactionHooks(async (transactionHooks) =>
  client.deleteChains({
    transactionHooks,
    ids: [reportChain.id, ...blockerChains.map((blocker) => blocker.id)],
  }),
);
```

`getJobBlockers` takes a job ID: a chain's head job has the chain's ID, and a continuation declared with its own `blockers` has to be queried separately (list the chain's jobs with `listChainJobs`). Repeat the lookup on each blocker chain to reach blockers of blockers. If any chain in the set is still a blocker of a job outside it — for example, a blocker shared with another report — the call throws `BlockerReferenceError` and deletes nothing; leave that chain out, or add its dependents to the set.

## How It Works

### What Gets Deleted

Given a list of `ids`, the operation deletes all jobs in each chain (every job where `job.chainId` matches a provided ID, including the head and continuations), together with the blocker references those jobs hold on other chains. References pointing at a deleted chain from a job outside the deletion set are never removed — they make the whole deletion fail (see below).

### Blocker Safety Check

Before deleting, the system checks whether any external chain depends on the target chains as blockers. "External" means the dependent job's own chain is not in the deletion set. This prevents orphaning blocked chains that would never unblock.

```
Chain A (blocker) --> Chain B (blocked)

deleteChains({ ids: [A] })    // BlockerReferenceError -- B depends on A
deleteChains({ ids: [A, B] }) // Both in deletion set -- no external refs
```

## See Also

See [examples/showcase-chain-deletion](https://github.com/kvet/queuert/tree/main/examples/showcase-chain-deletion) for a complete working example demonstrating simple deletion, blocker safety, and co-deletion. See also [Transaction Hooks](../transaction-hooks/) and [Job Blockers](../job-blockers/).
