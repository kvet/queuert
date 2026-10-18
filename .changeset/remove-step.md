---
"queuert": major
"@queuert/otel": minor
---

The attempt handler no longer receives `step`. Its guarded mid-attempt transactions are gone; staged handlers that batched transactional work through `step` should open their own transactions between `prepare` and `complete` (and keep that work idempotent, since it is no longer checked against attempt ownership) or move the writes into the `complete` callback. `prepare`, `complete` and staged mode are unchanged.

- Removed `step` from the attempt handler options.
- Removed the `wrapStep` hook from `AttemptMiddleware`; it drops its step ctx type parameter, so the complete ctx moves from the fifth to the fourth position.
- `@queuert/otel` no longer emits `step` spans or the `queuert.step.index` attribute.
