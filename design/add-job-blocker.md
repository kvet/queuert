# Add Job Blocker API Design

## Problem

Currently blockers can only be set at job creation time. There's no way to programmatically add blockers to an existing job. We need a client method `addJobBlocker` that supports up to 1M blockers per job.

## API Design

### `addJobBlocker` — Client Method

Adds blockers to an existing job. Accepts a batch of blocker chains.

```typescript
client.addJobBlocker({
  jobId,
  blockers: [chain1, chain2, ...],
  transactionHooks,
  ...txCtx,
})
```

- Allowed on `pending` or `blocked` jobs only (not `running`/`completed`)
- Dynamically added blockers bypass the type system's static `blockers` tuple — they're an escape hatch
- Callers adding 1M blockers should call in chunks (e.g., 10K at a time)

### `listJobBlockers` — Paginated Query

New paginated method (keeps existing `getJobBlockers` for small sets):

```typescript
client.listJobBlockers({
  jobId,
  cursor,
  limit: 100,
});
// returns Page<ResolvedJobChain<...>>
```

Follows the existing `getJobChain` / `listJobChains` naming pattern.

## Unblock Optimization (required for 1M scale)

### Problem

Current `unblockJobs` scans **all** blocker rows on every chain completion → O(n) per completion × n completions = O(n²). At 1M this is a dealbreaker.

### Solution: `remaining_blockers_count` Column

Add a counter column to the `job` table:

```sql
ALTER TABLE job ADD COLUMN remaining_blockers_count integer NOT NULL DEFAULT 0;
```

Maintained atomically:

- **`addJobsBlockers` / `addJobBlocker`**: increment by number of **incomplete** blockers added
- **`unblockJobs`**: decrement by 1 when a blocker chain completes

Rewritten `unblockJobs`:

```sql
UPDATE job
SET remaining_blockers_count = remaining_blockers_count - 1,
    status = CASE WHEN remaining_blockers_count - 1 = 0 THEN 'pending' ELSE status END,
    scheduled_at = CASE WHEN remaining_blockers_count - 1 = 0 THEN now() ELSE scheduled_at END
WHERE id IN (SELECT job_id FROM job_blocker WHERE blocked_by_chain_id = $1)
  AND status = 'blocked'
RETURNING *
```

O(1) per completion instead of O(n).

### Migration

Backfill for existing blocked jobs:

```sql
UPDATE job SET remaining_blockers_count = (
  SELECT COUNT(*)
  FROM job_blocker jb
  JOIN LATERAL (
    SELECT status FROM job j2
    WHERE j2.chain_id = jb.blocked_by_chain_id
    ORDER BY j2.chain_index DESC LIMIT 1
  ) lj ON lj.status != 'completed'
  WHERE jb.job_id = job.id
)
WHERE status = 'blocked';
```

## State Adapter Changes

### New Method: `addJobBlockers`

```typescript
addJobBlockers: (params: { txCtx?: TTxContext; jobId: TJobId; blockedByChainIds: TJobId[] }) =>
  Promise<{
    job: StateJob;
    addedCount: number;
    incompleteCount: number;
  }>;
```

### New Method: `listJobBlockers`

```typescript
listJobBlockers: (params: {
  txCtx?: TTxContext;
  jobId: TJobId;
  orderDirection: OrderDirection;
  page: PageParams;
}) => Promise<Page<[StateJob, StateJob | undefined]>>;
```

### Modified: `addJobsBlockersSql`

Must increment `remaining_blockers_count` by the number of incomplete blockers.

### Modified: `unblockJobsSql`

Rewritten to use counter-based approach (see above).

## Adapters to Update

- **PostgreSQL**: `sql.ts` (migration + query changes), `state-adapter.pg.ts`
- **SQLite**: `sql.ts` (migration + query changes), `state-adapter.sqlite.ts`
- **In-process**: Add `remainingBlockersCount` map, update `addJobsBlockers` and `unblockJobs`

## Observability Considerations

The existing blocker span creation creates one span per blocker. With 1M blockers, creating 1M spans is problematic. `addJobBlocker` should either skip per-blocker spans or aggregate them (e.g., a single span with `blocker.count` attribute).

## Open Questions

1. **Should `addJobBlocker` work on `running` jobs?** Proposed: no — adding blockers to something already executing is dangerous.
2. **Batching responsibility**: should the client auto-batch large arrays internally, or leave that to the caller?
3. **Should the counter optimization be a separate prerequisite change?** It touches existing `addJobsBlockers` and `unblockJobs` paths.

## Implementation Order

1. Schema migration: add `remaining_blockers_count` to `job` table (postgres + sqlite)
2. Rewrite `unblockJobsSql` to use counter
3. Update `addJobsBlockersSql` to set the counter
4. Update in-process adapter with counter tracking
5. Add `addJobBlocker` to state adapter interface + all adapters
6. Add `listJobBlockers` (paginated) to state adapter interface + all adapters
7. Add both methods to the client
8. Tests + docs
