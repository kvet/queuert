---
"queuert": minor
---

Propagate the worker's stop signal to in-flight job attempt handlers. When `stop()` is called on a worker, all running jobs now receive `"worker_stopping"` as the abort reason on their `signal`. This lets handlers distinguish a graceful worker shutdown from hard aborts (e.g. `"taken_by_another_worker"`) and wrap up cooperatively — finishing partial work, flushing buffers, or breaking out of long loops — instead of running to completion unaware that the worker is draining.
