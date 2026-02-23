# Deletion

## Overview

`deleteJobChains` removes entire chains (root job + all continuations) from the system. It is a mutating client method that requires `commitHooks` and a transaction context.

## What Gets Deleted

Given a list of `chainIds`, the operation deletes:

1. **All jobs in each chain** — every job where `job.chainId` matches a provided ID (root + continuations)
2. **Blocker references to those chains** — blocker entries pointing at deleted chains are cleaned up from surviving jobs

## Blocker Safety Check

Before deleting, the system checks whether any **external** chain depends on the target chains as blockers. "External" means the dependent job's own chain is not in the deletion set.

```
Chain A (blocker) ──→ Chain B (blocked)

deleteJobChains({ chainIds: [A] })    // ❌ BlockerReferenceError — B depends on A
deleteJobChains({ chainIds: [A, B] }) // ✅ Both in deletion set — no external refs
```

This prevents orphaning blocked chains that would never unblock.

## Return Value

Returns the deleted chains as `JobChain` objects (root job + optional last job in chain), preserving their state at the time of deletion.

## Running Job Signal

If a deleted chain has a currently running job, the worker's lease renewal detects the job is gone and aborts via signal with `reason: "not_found"`. The attempt handler receives this through its `signal` parameter.

## Proposed: Cascade Deletion

### Motivation

Currently, deleting a chain that has dependents requires the caller to know and enumerate all related chains. For deep dependency graphs, this is tedious and error-prone. A cascade option would let the system resolve the full dependency graph and delete everything in one operation.

### Dependency Graph

Chains form a DAG through blocker relationships:

```
         ┌──── Blocker X
         │
Main ────┤
         │              ┌── Blocker Z
         └── Blocker Y ─┘
```

Cascade delete starting from `Main` would delete `Main`, `Blocker X`, `Blocker Y`, and `Blocker Z` — the full connected component.

### Traversal Direction

The tree is resolved in both directions:

- **Downward (blockers)**: From a chain, find all chains it depends on, recursively
- **Upward (dependents)**: From a chain, find all chains that depend on it, recursively

Both directions are needed to collect the complete connected component.

### API Shape

Add an optional `cascade` flag to the existing method:

```typescript
client.deleteJobChains({
  chainIds: [chainId],
  cascade: true,
  commitHooks,
  ...txCtx,
});
```

- `cascade: true` — expand `chainIds` to the full connected component, then delete all. The blocker safety check is satisfied implicitly since all references are internal to the deletion set.
- `cascade: false` (default) — current behavior unchanged.

### Considerations

- Blocker graphs are DAGs by construction (blockers must exist at chain creation time), so cycles are impossible
- Running jobs in the tree are handled by the existing lease-renewal signal mechanism
- All adapters already support transactional multi-chain deletion; cascade only changes which chains are included in the set

## See Also

- [Job Chain Model](job-chain-model.md) — Chain structure, blockers, identity model
- [Client](client.md) — `deleteJobChains` API
- [Adapters](adapters.md) — State adapter interface, transactional design
