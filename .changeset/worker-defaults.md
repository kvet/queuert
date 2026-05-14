---
"queuert": major
---

`createInProcessWorker`: rename `workerId` option to `workerName`, and add a `defaults` option for worker-level `backoffConfig` / `leaseConfig` fallbacks.

The previous `workerId` option let callers set the worker's full identity directly, which is also used as the lease holder. Two replicas accidentally sharing the same `workerId` could collide on lease ownership. The option is now `workerName` — an optional human-readable label restricted to `/^[A-Za-z0-9._-]+$/` — and the runtime always appends a random UUID to produce the final worker id (`${workerName}-${uuid}`, or just `${uuid}` when omitted), making duplicate ids impossible to express. Observability events and error fields continue to expose the full (now-guaranteed-unique) id under `workerId`.

The new `defaults: { backoffConfig?, leaseConfig? }` option lets you set fleet-wide fallbacks that apply across every processor the worker dispatches to. Resolution order is: processor → registry → worker `defaults` → library default. The new `InProcessWorkerDefaults` type is re-exported from the package root.
