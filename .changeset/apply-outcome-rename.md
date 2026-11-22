---
"queuert": major
---

The attempt handler's `complete` is renamed to `applyOutcome`, to match the client's `applyJobOutcome`. It takes the same transaction context and outcomes, and returns the same job.
