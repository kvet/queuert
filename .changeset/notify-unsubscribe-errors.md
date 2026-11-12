---
"queuert": patch
---

A notify adapter whose unsubscribe fails no longer interrupts the worker or `awaitChain`: the failure is reported like any other notify adapter error, and the caller carries on.

- A rejected or thrown unsubscribe from `listenJobScheduled`, `listenChainCompleted` or `listenJobAttemptLost` is logged as a `notify_adapter_error` entry naming that operation.
