---
"queuert": major
---

Run transaction hook `flush` and `discard` concurrently.

`createTransactionHooks` previously iterated the registered hooks with a sequential `for…of await` and ran each hook's `flush` (and `discard`) one after the other in registration order. Both phases now dispatch all hooks at once via `Promise.allSettled`, await the batch, and re-throw the first rejection (preserving the existing "run all, then surface the first error" semantics).

### Why this is breaking

Cross-hook execution order is no longer guaranteed. If two distinct hook keys both register `flush` (or `discard`) callbacks, those callbacks now race rather than running in registration order. Code that relied on hook A finishing before hook B started will break.

In-tree hooks are unaffected:

- The observability hook registers every callback under a single shared hook key, so its callbacks still flush sequentially within that hook — the order of observability events continues to match the order of operations.
- Notify hooks (`notifyJobScheduled`, `notifyChainCompleted`) use independent keys and are inherently order-independent, so flushing them in parallel is the intended win.

### Performance

End-to-end throughput improves across every adapter combination measured by `benchmarks/processing-capacity`. Representative deltas from the published benchmark table:

- In-process state: ~13,616 → ~14,809 jobs/s end-to-end.
- SQLite (better-sqlite3): ~7,177 → ~8,396 jobs/s end-to-end.
- PostgreSQL (pg) notify: ~1,536 → ~1,948 jobs/s end-to-end.

### Migration

If you author a custom hook (`hooks.set(key, { state, flush, discard })`) and rely on ordering with respect to other hooks, you have two options:

1. **Register every event under a single hook key.** Accumulate ordered events in `state` and iterate them with `for…of await` inside `flush`/`discard`. This is what the observability hook does — within a single hook key, the library still awaits your callback to completion before considering the flush done, so intra-hook ordering is preserved.
2. **Make your hook order-independent.** If the side effects truly don't depend on each other (e.g. independent notifications), no change is needed — you'll just see them dispatch in parallel now.

There is no flag to restore the old sequential behavior; if you need ordering, fold the work into one hook.
