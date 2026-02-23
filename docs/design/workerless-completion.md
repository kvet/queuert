# Workerless Completion

## Overview

Jobs can be completed without a worker via `completeJobChain`. The caller drives the completion — receiving the current job, deciding what to do, and optionally continuing the chain. The completed job has `completedBy: null` (no worker identity).

## Use Cases

- **Approval workflows** — a job waits for human approval; an API endpoint completes it
- **Webhook-triggered completion** — an external service calls back when work is done
- **Deferred decisions** — schedule a job with a timeout, allow early completion based on user action (pairs with deferred start via `schedule`)

## How It Works

The caller receives the current job and a `complete` function. Inside `complete`, the caller can:

- Return an output to finish the chain
- Call `continueWith` to add the next job (same as the worker's prepare/complete pattern)

The `complete` function uses `FOR UPDATE` to lock the current job, preventing concurrent completion by a worker or another caller.

## Interaction with Workers

If a worker is already processing the job when `completeJobChain` runs:

- The worker detects the external completion via `JobAlreadyCompletedError`
- The worker's abort signal fires with reason `"already_completed"`
- The worker abandons its attempt gracefully

## See Also

- [Client](client.md) — `completeJobChain` method
- [Job Processing](job-processing.md) — Prepare/complete pattern, transactional design
- [OTEL Tracing](otel-tracing.md) — Span hierarchy for workerless completion
