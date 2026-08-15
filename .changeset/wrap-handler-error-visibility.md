---
"@queuert/core": major
---

`wrapHandler` middleware can now observe attempt failures. The handler middleware chain has been moved inside `runJobAttempt`, wrapping the `attemptHandler` call directly — the same pattern as `wrapPrepare`, `wrapStep`, and `wrapComplete`. A `catch` block around `next()` in `wrapHandler` now fires on handler errors, and `finally` runs before the reschedule (not after). Previously dead `catch` blocks in existing `wrapHandler` middleware will become live.
