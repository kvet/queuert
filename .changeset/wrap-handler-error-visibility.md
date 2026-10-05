---
"queuert": major
---

`wrapHandler` middleware can now observe attempt failures. The handler middleware chain wraps the `attemptHandler` call directly, so a `catch` block around `next()` in `wrapHandler` now fires on handler errors, and `finally` runs before a failed attempt is scheduled for retry (not after). Previously dead `catch` blocks in existing `wrapHandler` middleware will become live.
