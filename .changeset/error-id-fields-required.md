---
"queuert": major
---

Tighten public error class fields to non-optional. The contextual fields on `JobTakenByAnotherWorkerError`, `JobNotFoundError`, `ChainNotFoundError`, `JobAlreadyCompletedError`, `JobNotTriggerableError`, and `WaitChainTimeoutError` are now typed as `string` / `number` instead of `string | undefined` / `number | undefined`, and their constructor options have been promoted from optional to required. Every internal throw site already supplied these values, so consumers handling caught errors no longer need to widen their types or null-check the IDs; external callers that construct these errors directly must now pass the corresponding option (e.g. `new JobNotFoundError(msg, { jobId })`).

`JobTakenByAnotherWorkerError.leasedBy` follows a slightly different shape: its constructor option stays optional, but the stored field is now `string | null` (no longer `string | null | undefined`) — an omitted option is normalized to `null`. Catch blocks that narrowed via `if (err.leasedBy === undefined)` should switch to `=== null`.
