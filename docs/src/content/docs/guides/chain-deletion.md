---
title: Chain Deletion
description: Delete job chains with blocker safety and cascade support.
sidebar:
  order: 13
---

Job chains can be deleted using `deleteJobChains`. All jobs in the chain (entry job and continuations) are removed together.

```ts
await withTransactionHooks(async (transactionHooks) =>
  client.deleteJobChains({
    transactionHooks,
    ids: [chain.id],
  }),
);
```

If a chain is referenced as a blocker by another chain, deletion is rejected unless both chains are deleted together:

```ts
await withTransactionHooks(async (transactionHooks) =>
  client.deleteJobChains({ transactionHooks, ids: [blockerChain.id] }),
); // throws

await withTransactionHooks(async (transactionHooks) =>
  client.deleteJobChains({ transactionHooks, ids: [mainChain.id, blockerChain.id] }),
); // ok
```

## Cascade Deletion

Use `cascade: true` to automatically resolve and delete transitive dependencies (blockers) without enumerating them manually:

```ts
await withTransactionHooks(async (transactionHooks) =>
  client.deleteJobChains({
    transactionHooks,
    ids: [mainChain.id],
    cascade: true,
  }),
);
```

Cascade follows dependencies downward -- it deletes the specified chains and everything they depend on. If any chain in the resolved set is still referenced by an external chain, deletion is rejected with `BlockerReferenceError`.

If a worker is currently processing a job in a deleted chain, the worker's `signal` is aborted with reason `"not_found"`, allowing graceful cleanup.

See [examples/showcase-chain-deletion](https://github.com/kvet/queuert/tree/main/examples/showcase-chain-deletion) for a complete working example demonstrating simple deletion, blocker safety, co-deletion, and cascade deletion. See also [Transaction Hooks](../transaction-hooks/) and [Job Blockers](../job-blockers/).

## How It Works

### What Gets Deleted

Given a list of `ids`, the operation deletes all jobs in each chain (every job where `job.chainId` matches a provided ID, including root and continuations) and cleans up blocker references pointing at deleted chains from surviving jobs.

### Blocker Safety Check

Before deleting, the system checks whether any external chain depends on the target chains as blockers. "External" means the dependent job's own chain is not in the deletion set. This prevents orphaning blocked chains that would never unblock.

```
Chain A (blocker) --> Chain B (blocked)

deleteJobChains({ ids: [A] })    // BlockerReferenceError -- B depends on A
deleteJobChains({ ids: [A, B] }) // Both in deletion set -- no external refs
```

### Cascade Resolution Algorithm

Chains form a DAG through blocker relationships. Cascade delete starting from a chain follows dependencies downward to include all transitive blockers:

```
Main --depends on--+-- Blocker X
                   |
                   +-- Blocker Y --depends on-- Blocker Z
```

Cascade delete starting from `Main` resolves to: `Main`, `Blocker X`, `Blocker Y`, and `Blocker Z`. The traversal direction is downward only -- from a chain to its blockers, recursively. The blocker safety check still applies to the expanded set: if any chain in the resolved set is referenced by an external chain, the operation throws `BlockerReferenceError`.

Blocker graphs are DAGs by construction (blockers must exist at chain creation time), so cycles are impossible. Running jobs in the resolved set are handled by the existing lease-renewal signal mechanism.
