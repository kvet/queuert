---
"queuert": patch
---

Fix a spurious type error from `createInProcessWorker`'s `requiredAttemptMiddleware` check when the middleware was typed against a user-supplied `StateAdapter` alias (e.g. `AttemptMiddleware<MyStateAdapter>`). Valid processor slices were being flagged as missing required middleware. Runtime behavior was unaffected; this is a type-only fix.
