# Deletion

## Overview

`deleteJobChains` removes entire chains (root job + all continuations) from the system. It is a mutating client method that requires `transactionHooks` and a transaction context.

## What Gets Deleted

Given a list of `ids`, the operation deletes:

1. **All jobs in each chain** — every job where `job.chainId` matches a provided ID (root + continuations)
2. **Blocker references to those chains** — blocker entries pointing at deleted chains are cleaned up from surviving jobs

## Blocker Safety Check

Before deleting, the system checks whether any **external** chain depends on the target chains as blockers. "External" means the dependent job's own chain is not in the deletion set.

```
Chain A (blocker) ──→ Chain B (blocked)

deleteJobChains({ ids: [A] })    // ❌ BlockerReferenceError — B depends on A
deleteJobChains({ ids: [A, B] }) // ✅ Both in deletion set — no external refs
```

This prevents orphaning blocked chains that would never unblock.

## Return Value

Returns the deleted chains as `JobChain` objects (root job + optional last job in chain), preserving their state at the time of deletion.

## Running Job Signal

If a deleted chain has a currently running job, the worker's lease renewal detects the job is gone and aborts via signal with `reason: "not_found"`. The attempt handler receives this through its `signal` parameter.

## Cascade Deletion

### Motivation

Deleting a chain that has dependents normally requires the caller to know and enumerate all related chains. For deep dependency graphs, this is tedious and error-prone. The `cascade` option resolves the full dependency graph and deletes everything in one operation.

### Dependency Graph

Chains form a DAG through blocker relationships:

```
Main ──depends on──┬── Blocker X
                   │
                   └── Blocker Y ──depends on── Blocker Z
```

Cascade delete starting from `Main` follows dependencies downward to include `Main`, `Blocker X`, `Blocker Y`, and `Blocker Z` in the deletion set.

### Traversal Direction

Cascade resolves dependencies **downward only** — from a chain, it finds all chains it depends on (blockers), recursively.

```
A ← B ← C   (C depends on B, B depends on A)

deleteJobChains({ ids: [C], cascade: true })  // ✅ Deletes C, B, A
deleteJobChains({ ids: [A], cascade: true })  // ❌ BlockerReferenceError — B depends on A
```

The blocker safety check still applies to the expanded set: if any chain in the resolved set is referenced as a blocker by an external chain, the operation throws `BlockerReferenceError`.

### API Shape

```typescript
client.deleteJobChains({
  ids: [chainId],
  cascade: true,
  transactionHooks,
  ...txCtx,
});
```

- `cascade: true` — expand `ids` to include transitive dependencies (downward), then delete all. The blocker safety check runs on the expanded set.
- `cascade: false` (default) — current behavior unchanged.

### Considerations

- Blocker graphs are DAGs by construction (blockers must exist at chain creation time), so cycles are impossible
- Running jobs in the tree are handled by the existing lease-renewal signal mechanism
- All adapters support transactional multi-chain deletion; cascade only changes which chains are included in the set

## See Also

- [Job Chain Model](job-chain-model.md) — Chain structure, blockers, identity model
- [Client](client.md) — `deleteJobChains` API
- [Adapters](adapters.md) — State adapter interface, transactional design
