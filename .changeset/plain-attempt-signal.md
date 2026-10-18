---
"queuert": major
"@queuert/otel": minor
---

The attempt handler's `signal` is now a plain `AbortSignal` with no typed reason. Handlers react to every abort the same way: stop working, then call `complete` to keep progress or throw to reschedule. If this worker lost the attempt or can no longer confirm it owns it, `complete` throws the matching error (`JobTakenByAnotherWorkerError`, `JobNotFoundError`, `JobAlreadyCompletedError`, or the error that failed the heartbeat), so code that branched on `signal.reason` should drop the check or catch those errors instead.

- Removed the `JobAbortReason` and `TypedAbortSignal` type exports; `signal` is typed as `AbortSignal`.
- `@queuert/otel` no longer records the `abort` span event or the `queuert.abort.reason` attribute on attempt spans.
