# Reschedule as a Terminal Outcome

## Problem

Rescheduling the currently-executing job only works by throwing:

```ts
rescheduleJob({ afterMs: 60_000 }); // throws RescheduleJobError
```

Two things follow from that, both wrong:

1. **A deliberate reschedule is reported as a failure.** It travels the error path, so it writes
   `last_attempt_error` and emits `jobAttemptFailed`. A rate-limited API saying "come back in a
   minute" lands in the error logs, the failure counter, and the span as a failed attempt.
2. **`rescheduleJob` names two different operations.** The exported helper throws and targets the
   current job; `client.rescheduleJob({ id, schedule })` writes and targets an arbitrary pending
   job. Same verb, different subject, different mechanism.

## API

`reschedule` joins the shipped `{ output }` / `{ continueWith }` outcome vocabulary applied by
`finish`:

```ts
return complete(async ({ finish }) => {
  const res = await callRateLimitedApi(job.input);
  if (res.retryAfter) return finish({ reschedule: { afterMs: res.retryAfter } });
  return finish({ output: res.data });
});
```

It is attempt-level: unlike the two chain-level outcomes it leaves the job alive.

- No `lastAttemptError`, no `jobAttemptFailed`. The span ends `ok`; `jobRescheduled` still fires.
- `attempt` is bumped — a reschedule is an attempt that happened.

`rescheduleJob` and `RescheduleJobError` are **deleted**. `client.rescheduleJob(s)` keeps its name
and signature and becomes the only `rescheduleJob` in the API.

## Reasoning

**Why an outcome and not a fixed error path.** Reschedule and fail differ by exactly one thing:
whether an error occurred. Modelling that as a descriptor puts the distinction where the handler
already states its result, instead of inferring it from a special error class. `handleJobHandlerError`
loses its special case and becomes purely the failure path.

**Why delete rather than rename.** Renaming to `rescheduleSelf` fixes the collision but keeps two
ways to do one thing — one of them control flow disguised as an error, un-typecheckable against the
job's schedule options, and special-cased in the error path forever. Same migration cost, half the
surface.

**The cost.** Handlers that rescheduled from five frames down lose the escape hatch and must return
a decision up to `complete`. That is real restructuring. Throwing still reschedules with backoff,
which is what most of those call sites were approximating anyway.

**The bump's consequence.** There is no max retry count in Queuert, so bumping `attempt` is not a
ceiling — it moves the backoff curve. A job that reschedules twenty times and then genuinely fails
backs off as if it had already failed twenty times. Long-polling pays for its polls the first time
something breaks. Document it, don't design around it.

## Open question

**`jobRescheduled` vs a new event.** Reusing it mixes "failed, backing off" with "asked to come
back later". A `reason` discriminator would separate them — related to
`design/attempt-abort-events.md`.
