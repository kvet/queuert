---
"queuert": major
"@queuert/postgres": minor
"@queuert/redis": minor
"@queuert/nats": minor
"@queuert/ipc": minor
---

`NotifyAdapter` listens for chain completions and lost attempts on many ids with one call, so `awaitChains` holds one subscription for all its chains instead of one per chain. Custom notify adapters need to implement the new method signatures.

- `listenChainCompleted(chainId, onNotification)` becomes `listenChainsCompleted(chainIds, onNotification)`, and `onNotification` receives the completed chain's id.
- `listenJobAttemptLost(jobId, onNotification)` becomes `listenJobAttemptsLost(jobIds, onNotification)`, and `onNotification` receives the job's id.
- `listenJobScheduled` is renamed `listenJobsScheduled`, matching `notifyJobsScheduled`.
- The PostgreSQL, Redis, NATS and IPC notify adapters register a listener for every id in one step.
- `notify_adapter_error` log entries name the operations `listenJobsScheduled`, `listenChainsCompleted` and `listenJobAttemptsLost`.
