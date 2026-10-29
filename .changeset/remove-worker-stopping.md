---
"queuert": major
"@queuert/otel": major
---

The `workerStopping` observability event is removed. A worker's stop begins with your own call to the function returned by `start()`, so the event only repeated what the caller already knew; `workerStopped` still marks the end of shutdown.

- `ObservabilityAdapter.workerStopping` is removed; custom observability adapters drop the method.
- The `worker_stopping` log type is removed.
- The `queuert.worker.stopping` OTEL counter is removed.
