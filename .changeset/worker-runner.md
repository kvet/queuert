---
"queuert": major
---

`createInProcessWorker` is renamed to `createWorkerRunner` and its `InProcessWorker` type to `WorkerRunner`, so "worker" keeps meaning one row in the `worker` table and "worker runner" names the object that runs it. The worker runner gains `stop()`, `close()` and `[Symbol.asyncDispose]`, so it can be held with `await using` next to the adapters; `start()` resolves to `undefined` instead of a stop function, so call `workerRunner.stop()` where you called the returned function. Options, events and errors are unchanged.

- Renamed: `createInProcessWorker` → `createWorkerRunner`, `InProcessWorker` → `WorkerRunner`.
- `stop()` does nothing when the worker runner is not started, and concurrent calls wait for the same shutdown; a stopped worker runner can be started again.
- `close()` stops the worker runner if it is started and makes every later `start()` throw; `[Symbol.asyncDispose]` calls `close()`. A top-level `await using` closes the worker runner when the module finishes, so a long-running process keeps its scope open until it shuts down.
- Configuration error messages start with `createWorkerRunner:`.
- The docs page moves from `/how-it-works/in-process-worker/` to `/how-it-works/worker-runner/`; the old URL has no redirect, so update bookmarks and links to it.
