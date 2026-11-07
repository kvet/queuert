---
"queuert": major
---

`createInProcessWorker` is renamed to `createWorkerRunner` and its `InProcessWorker` type to `WorkerRunner`, so "worker" keeps meaning one row in the `worker` table and "worker runner" names the object that runs it. Options, `start()`, events, errors and behavior are unchanged; rename each import and call site.

- Renamed: `createInProcessWorker` → `createWorkerRunner`, `InProcessWorker` → `WorkerRunner`.
- Configuration error messages start with `createWorkerRunner:`.
- The docs page moves from `/how-it-works/in-process-worker/` to `/how-it-works/worker-runner/`; the old URL has no redirect, so update bookmarks and links to it.
