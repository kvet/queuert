# triggerJobs (plural) & deleteJobChain (singular)

Add the missing plural/singular counterparts to complete the client API surface.

## Motivation

`startJobChain` / `startJobChains` already exist as a singular/plural pair. `triggerJob` and `deleteJobChains` only have one form each, forcing users to write boilerplate for common cases:

- **Triggering multiple jobs** — users must loop over `triggerJob`, which means N sequential validations and N adapter calls instead of one batch operation. Common when unpausing a set of scheduled jobs or triggering a fan-out.
- **Deleting a single chain** — users must wrap a single ID in an array and unpack the result. Worse, `deleteJobChains` silently ignores missing IDs, so `deleted[0]` can be `undefined` without any error — an easy source of bugs when the caller expects the chain to exist.

## API

### deleteJobChain

```typescript
const deleted = await client.deleteJobChain({
  id: chainId,
  cascade?: boolean,
  transactionHooks,
  tx,
});
// → JobChain
```

Same semantics as `deleteJobChains`, except:

- Accepts a single `id` instead of `ids[]`
- Returns a single `JobChain` instead of `JobChain[]`
- Throws `JobChainNotFoundError` when the chain does not exist (the plural variant silently skips missing IDs)

### triggerJobs

```typescript
const jobs = await client.triggerJobs({
  ids: [jobId1, jobId2, jobId3],
  transactionHooks,
  tx,
});
// → Job[]
```

Same semantics as `triggerJob`, except:

- Accepts `ids[]` instead of a single `id`
- Returns `Job[]` in input order
- Validation is atomic: if any job is missing or not pending, the entire call fails before any job is triggered (throws `JobNotFoundError` or `JobNotTriggerableError` for the first invalid job)

After `triggerJobs` is added, `triggerJob` becomes a thin wrapper (same pattern as `startJobChain` → `startJobChains`).

## Error Behavior

| Method                       | Job/chain missing       | Job not pending          |
| ---------------------------- | ----------------------- | ------------------------ |
| `triggerJob` (existing)      | `JobNotFoundError`      | `JobNotTriggerableError` |
| `triggerJobs` (new)          | `JobNotFoundError`      | `JobNotTriggerableError` |
| `deleteJobChains` (existing) | silently skips          | n/a                      |
| `deleteJobChain` (new)       | `JobChainNotFoundError` | n/a                      |

`JobChainNotFoundError` is new — follows the same shape as `JobNotFoundError`.

## Decisions

1. **`triggerJobs` validates strictly** — fails entirely on the first invalid job. Triggering is an intentional action with side effects; a silently skipped trigger is a lost job. `deleteJobChains` stays lenient because deletion is idempotent — "make sure these are gone" doesn't care if some are already gone.
2. **Empty `ids` array is a no-op** returning `[]`, consistent with `startJobChains`.
3. **Singular `deleteJobChain` throws on missing chain** — when targeting a specific ID, the caller expects it to exist. The lenient behavior only makes sense for bulk cleanup in `deleteJobChains`.
