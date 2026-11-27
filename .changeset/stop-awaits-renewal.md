---
"queuert": patch
---

A worker runner's stop waits for a lease renewal in flight, for at most `heartbeatMs` and never past the lease's local deadline, so it no longer resolves while the renewal's statement or its retry is still running against the database.
