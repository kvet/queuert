# User-owned transactions

Queuert stops opening transactions around job processing. The worker's own bookkeeping (acquire, heartbeat, reclaim, reschedule-on-error) becomes single fenced statements; the only transaction an attempt touches is the user's, passed to `finish`. Correctness comes from conditional writes, not from queuert-level locks. Migrations keep `withTransaction`.

## Problem

Today an attempt can span up to four queuert-owned transactions: the acquire/"prepare" transaction (`in-process-worker.ts:118`), per-heartbeat guarded transactions, the "complete" transaction with the user callback inside a savepoint (`job-process.ts:390-402`), and an error transaction that rolls back to the savepoint and reschedules (`job-process.ts:561`). Ownership is enforced by `refetchJobLocked` (`SELECT … FOR UPDATE` + `attemptBy === workerId`) at the start of each.

This costs us:

- **API surface**: `prepare`, `step`, `complete`, atomic/staged modes, auto-setup inference, and `wrapPrepare`/`wrapStep`/`wrapComplete` middleware. `job-process.ts` is ~600 lines of transaction choreography.
- **Adapter requirements**: savepoints (`withSavepoint`), pessimistic read locks (`lock: "exclusive"`), and in atomic mode a transaction held open across user I/O. Savepoints and long-held processing transactions are what make adapters hard to write.
- **Observability**: prepare/step/complete sub-spans and the transactional buffering that goes with them.
- **A latent bug**: the ownership check uses `attemptBy` only. A worker with concurrency > 1 can re-acquire a job it lost (reclaimed, then picked again by another of its slots); both slots pass `attemptBy === workerId`.

## Solution

### Handler API

```ts
attemptHandler: async ({ job, signal, finish }) => {
  const result = await callSomeApi(job.input);
  return withTransactionHooks(async (transactionHooks) =>
    db.transaction(async (tx) => {
      await tx.orders.update(/* … */);
      return finish({ tx, transactionHooks, output: result });
    }),
  );
};
```

- `finish({ ...txCtx, transactionHooks, output | continueWith | reschedule })` — same spreading convention as `client.createChain`. Returns today's typed `AttemptFinishResult` (for code that needs the completed job or its continuation).
- The handler must return what `finish` returned (`Promise<AttemptFinishResult>`, as today's handler returns the completed job), so a forgotten `finish` is a compile error. The user propagates it out of their transaction and hooks callbacks (`return withTransactionHooks(… db.transaction(async (tx) => finish(…)))`). `wrapHandler` stays generic over that result and passes it through. The type proves `finish` was called; the returned receipt tells the worker whether it committed (see "Commit detection"). A retried transaction returns the last call's receipt.
- The transaction context and `transactionHooks` are **always required** (typed, plus the `requireTxCtx` runtime backstop). `finish`'s writes are multi-statement (complete + unblock dependents, continue + add blockers), so they need a transaction, and queuert never opens one for processing. The type must not let `txCtx` collapse to optional for loosely typed adapters (in-process).
- `prepare`, `step`, `complete`, `AttemptPrepare*`, `AttemptStep`, `AttemptComplete*` and the processing modes are removed. Work that used `step` (batched deletes in cleanup) runs in the user's own transactions; those intermediate writes are not ownership-fenced and must be idempotent (true for every in-repo use).
- Blockers are no longer preloaded. `job.blockers` is removed from the handler's job; the handler gets `getBlockers({ ...txCtx? })` instead, typed as `job.blockers` is today (present only for job types that declare blockers) and backed by `stateAdapter.getJobBlockers`. Many handlers only need to know the job is unblocked, which acquisition already guarantees, so they pay no read. `txCtx` is optional: a handler may read blockers inside the transaction it passes to `finish`.

### Fencing instead of locking

Every attempt-scoped write is a conditional write on the job row: `status = 'running' AND attempt = N AND attempt_by = workerId`. `attempt` is only incremented by `startJobAttempt`, never by reclaim or reschedule (verified in all three adapters), so each acquisition gets a unique N — this fixes the same-worker re-acquire bug. `attempt_by` stays in the fence because `attempt` restarts at 0 if a chain is deleted and recreated with the same caller-supplied id.

**All-or-nothing writes.** A fenced method either writes everything or nothing:

- Every derived write is driven from the `RETURNING` of the fenced job `UPDATE` — e.g. `WITH done AS (UPDATE job … WHERE id = $1 AND status = 'running' AND attempt = $n AND attempt_by = $w RETURNING …) UPDATE job h … FROM done` for the chain head, `INSERT … SELECT … FROM done` for a continuation. Putting the fence in a CTE is wrong (Postgres re-checks only the target row's `WHERE` after a lock wait), and putting it only in the final `WHERE` is also wrong: `completeJobs` would still complete the head row and `continueJobs` would still insert the continuation from a stale snapshot.
- Head == job (single-job chain) is one row, one update.
- SQLite `continueJobs` is two statements: run the fenced `UPDATE` first and insert the continuation only for rows it returned.
- **Invariant**: inside `finish` (and `client.createChain`/`createChains`), every validation and every JS-level throw happens before the first state-changing write (`parseOutput`, `validateContinueWith`, blocker existence). Once writing starts, the only failures are database errors. This matters because the user decides whether their transaction rolls back; a caught error must never leave a half-written chain.
- **Blockers first**: when an outcome or a new chain has blockers, the first statement locks the blocker heads with `stateAdapter.getChains({ txCtx, ids, lock: "exclusive" })` (`FOR UPDATE`, as `lockBlockerChains` already does) and throws `ChainNotFoundError` if any is missing — before the fenced write or `createJobs`. `addJobsBlockers` stays insert-only. The head lock also keeps a blocker from being deleted or completed unseen until commit. A head lock followed by a fence miss is harmless. The `job_blocker` rows are inserted after the fenced write.

**Fence miss.** A fenced write that matches nothing returns `undefined`. Core classifies with one plain read: `not_found`, `already_completed`, `taken_by_another_worker`, plus `jobAttemptExpired` observability when the lease had lapsed (today emitted only from `refetchJobLocked`; the metric `queuert.job.attempt.expired` is kept).

The fenced `UPDATE`'s own row lock serializes the finisher against reclaim and acquire (both `SKIP LOCKED`) until the user's transaction ends. `refetchJobLocked` is deleted.

The fence is optional per call: `client.completeChain` (workerless, deliberately takes over running jobs) and `client.rescheduleJobs` call the same adapter methods unfenced. A workerless takeover makes the worker's later fenced write miss → `already_completed`.

### Worker-owned writes become single statements

| Operation                            | Today                                             | New                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acquire (`startJobAttempt`)          | inside prepare tx, no lease set                   | autocommit, sets `attempt_until = now() + <timeout of the acquired job's type>`                                                                                                                               |
| Heartbeat (`extendJobAttempt`)       | guarded tx + `refetchJobLocked`, staged mode only | autocommit, fenced, on from acquire until the handler ends                                                                                                                                                    |
| Reclaim (`reclaimExpiredJobAttempt`) | `withTransaction`                                 | autocommit; stamps `last_attempt_at`/`last_attempt_error` so a reclaim is distinguishable from a `finish({ reschedule })` (`last_attempt_error` is a fixed string `JobAttemptExpiredError: …` passed by core) |
| Reschedule on handler error          | guarded tx, rollback to savepoint                 | autocommit fenced `rescheduleJobs`                                                                                                                                                                            |
| Attempt-lost check (notify)          | guarded tx with `refetchJobLocked`                | plain `getJobs` read, compare `status`/`attempt`/`attempt_by`                                                                                                                                                 |

Setting the lease at acquire is mandatory: reclaim requires `attempt_until IS NOT NULL` (`pg:1372`, `sqlite:1493`), and atomic-mode attempts never set it — they relied on the acquire transaction rolling back on crash. A crash now always consumes an attempt and is recovered by reclaim (today's staged behaviour, now universal). The attempt-lost listener is now on for every attempt (it already was for auto-staged handlers).

`txCtx` becomes optional on `startJobAttempt`, `extendJobAttempt`, `reclaimExpiredJobAttempt`, `rescheduleJobs` (providers' `executeSql` already accepts it). Multi-statement methods (`continueJobs`, `unblockJobs`, `addJobsBlockers`, `createJobs`, `deleteChains`) keep requiring it.

### Chain completion and the blocker race

A dependent registered on chain X (`addJobsBlockers`) races with X completing. Today correctness relies on the completer pre-locking X's head (`state-adapter.ts:151-153`); that lock was `refetchJobLocked`, which is going away.

New contract — **the completer writes the chain head, the adder locks it**:

- `completeJobs` writes X's head (`chain_status = 'completed'`) — already true.
- The adder locks each blocker head (`lockBlockerChains`, unchanged). Under READ COMMITTED one side waits for the other.
- `finish({ output })` always runs `unblockJobs` after completing a chain (the `hasBlockedJobs` gate and the field itself are removed from `completeJobs`). It is a separate statement with a fresh snapshot after the head wait, so it sees blocker rows the adder committed. Cost: one indexed probe on `job_blocker(blocked_by_chain_id)` per chain completion.
- Completion-first order works: under READ COMMITTED the adder's `FOR UPDATE` waits, then returns the latest version and sees `completed`, so the dependent starts `pending`.
- This holds only under READ COMMITTED: under REPEATABLE READ a lock-only row does not count as concurrently updated, so the completer would read a stale snapshot. Stricter levels are out of scope for now (see "Isolation levels").

No lock-order guarantee is claimed. A single `UPDATE` locks rows in plan order, the user's transaction may already hold arbitrary locks, and cross-blocker continuations (A waits on B while B waits on A) can deadlock today. Postgres deadlock detection is the backstop; on the worker side a deadlock is a handler error → fenced reschedule.

### Commit detection: the returned receipt

`finish` writes inside the user's transaction, so the worker cannot know by itself whether that transaction committed. The handler tells it: every `finish` call returns a fresh **receipt** (the typed `AttemptFinishResult`), and the handler returns it. A receipt becomes **committed** when the caller's `transactionHooks` flush with it as their latest `finish` call. With the documented nesting (hooks wrap the transaction) that flush runs right after COMMIT.

- **Hook bookkeeping.** One hook per hooks scope (key `queuert.finish`) holds the `finish` calls made in it, each with its own buffered events (completion observability, notifications). Last call wins: on flush only the latest call is marked committed and releases its events, and the earlier ones are discarded. The hook's `checkpoint` drops the calls made after a `transactionHooks` savepoint when it rolls back, so a `finish` rolled back in a paired savepoint never commits its receipt. This handles drivers and user loops that retry the transaction callback (for example after a deadlock). The `createFinishOnce` failure latch is removed for the worker `finish`.
- **Fast path.** The handler returned a committed receipt and did not throw → report the outcome and stop. No database statement; the heartbeat already stopped when the receipt committed.
- **Everything else fails the attempt.** The handler threw, returned nothing, or returned a receipt that is not committed → run the fenced reschedule (backoff, `jobAttemptFailed`, failed span status; on a normal return the error is "Attempt handler returned without a committed `finish`"). It is also the safety net for hooks nested inside the transaction, whose flush runs before a COMMIT that can still fail: the handler then throws, the reschedule matches `running`@N, and the job is retried.
- **On a miss**, if a receipt committed, our `finish` committed before the throw: report that outcome and record the error, without a read. Only when no receipt committed (hooks wrapped differently than the transaction) does the worker classify with one read. Accepted imprecision there: if our committed `finish({ reschedule })` is re-acquired by another slot before the read, the classifier sees `running`@N+1 and reports `taken_by_another_worker`; job state is still correct, only that attempt's observability is off.
- Classification rules (fallback read, renewal miss, attempt-lost listener): `completed`/continued with `completedBy = workerId` at attempt N, or `pending`@N with `last_attempt_error IS NULL` and `last_attempt_at` ≥ attempt start (our `finish({ reschedule })`), means our `finish` committed. Anything else is the real reason (`taken_by_another_worker`, `already_completed`, `not_found`).
- **Behaviour change**: an error thrown after a committed `finish` no longer rolls the completion back (today the complete transaction stays open until the handler returns, `job-process.ts:528-530`).
- **Known hole**: a `finish` rolled back by a raw database savepoint that is not paired with a `transactionHooks` savepoint, whose receipt the handler still returns, takes the fast path while the job stays `running`. Reclaim recovers it when the lease expires, at the cost of an attempt. This is the same pairing rule every queuert call inside a savepoint already follows, and it is documented for `finish`. Worker liveness must keep a way to reclaim such a job, since it drops the per-attempt lease (see "Interplay with other designs").

### Heartbeat

The heartbeat runs from acquire until the handler ends or a receipt commits, whichever comes first; `finish` itself does not pause or resume it. `finish` is treated as the handler's last call inside the user's transaction, and the database row lock does the serializing: a renewal issued while the user's transaction holds the job row just waits (it is never awaited by `finish`, so the SQLite rw lock cannot deadlock).

- A renewal that matches `running`@N extends the lease — including after a `finish` the user rolled back, which is correct: the attempt is still ours.
- A renewal that misses is classified with one read. If the job was completed/continued by this worker at attempt N, or is `pending`@N from our own `finish({ reschedule })`, the miss is a no-op: there is nothing left to renew, the heartbeat stops, and no abort fires. Anything else is a real loss and aborts as today.
- The attempt-lost listener uses the same classification, so our own committed `finish` never reads as a lost attempt.
- Work the user does after a committed `finish` is their responsibility: an error there is recorded, but nothing is rolled back or rescheduled (see "Commit detection").

### SQLite

SQLite providers use one connection guarded by a process-wide rw lock. Autocommit statements (other slots' acquire, heartbeats, reclaim) run on that connection under the lock. A handler that opens its own transaction **without** the lock would let those statements run inside it, and a rollback would undo another slot's acquire. Today only client calls had this requirement; now every `finish` does. No helper is shipped; the requirement is documented in `advanced/sqlite-internals.md`, `advanced/job-processing.mdx`, and shown in the `state-sqlite-*` examples.

### Middleware and observability

- `AttemptMiddleware` keeps only `wrapHandler`; `wrapPrepare`/`wrapStep`/`wrapComplete`, `Merged{Prepare,Step,Complete}Ctx` and their `run*MiddlewareChain` go. The Prepare/Step/Complete ctx type parameters drop everywhere they appear (`AttemptMiddleware` 5 → 2, `InProcessWorkerProcessor` 7 → 4, and the `any` arguments in `Processors`/`StampedProcessor`).
- One attempt span. `JobAttemptSpanHandle.startPrepare/startStep/startComplete`, `SpanHandle` and otel's `createSubSpanHandle` are removed; `recordAbort` and `end` stay. Metrics unchanged.
- Worker-side events (started, extended, failed, rescheduled) are emitted directly — their writes are autocommit. Events from `finish` are buffered into the user's `transactionHooks`, as `client.completeChain` already does.

### State adapter surface

One breaking `StateAdapter` release covering everything below, so adapter authors migrate once.

- **Removed**: `withSavepoint` (core's only callers were `job-process.ts:278,401`), provider `withSavepoint`, conformance `with-savepoint.ts`; the caller-pre-lock precondition on `completeJobs`.
- **Kept**: `withTransaction` (migrations, test helpers), `transactionConcurrency`, `lock: "exclusive"` on `getJobs`/`getChains` (client paths, see below).
- **Removed fields**: `hasBlockers` on `startJobAttempt`'s result and `hasBlockedJobs` on `completeJobs`'s result. `getJobBlockers` stays (client and the handler's `getBlockers`).
- **Changed**: `startJobAttempt({ timeoutMsByTypeName: { [typeName]: number }, workerId, txCtx? })` — the map replaces `typeNames` (its keys are the type filter, its values are each type's resolved `attemptConfig.timeoutMs`, per-processor or worker default; Postgres joins `unnest($types, $timeouts)` to pick the lease for the acquired row); required `fence: { attempt, workerId }` on `extendJobAttempt` (replaces its top-level `workerId`); optional `fence: { attempt, workerId }` per job on `completeJobs`/`continueJobs`/`rescheduleJobs`; `reclaimExpiredJobAttempt` takes the `lastAttemptError` string to stamp; all-or-nothing fenced writes; `addJobsBlockers` stays insert-only; reclaim stamps the last-attempt fields; optional `txCtx` on worker-owned methods.
- **Contract text** (docs + conformance): head row is the serialization point (the completer writes it, the blocker side locks it); fenced writes are all-or-nothing; `startJobAttempt`'s skipping of chains whose head is held is an optimisation, not a requirement.

### Client paths keep their locks

`client.rescheduleJobs` and `client.completeChain` keep `getJobs`/`getChains` with `lock: "exclusive"`. These locks run inside the user's transaction, so they do not conflict with the goal, and lock-then-check is safe under READ COMMITTED. `lockBlockerChains` stays too.

### Isolation levels

Users now choose the isolation level of every transaction that touches queuert state. Only READ COMMITTED (the Postgres default) is supported for now; REPEATABLE READ and SERIALIZABLE are deferred.

- Fenced `UPDATE` (worker `finish`): waits on the row, re-checks the fence, 0 rows on a miss.
- `SELECT … FOR UPDATE` then check (client paths, blocker heads): waits, returns the latest row.
- Autocommit worker statements (acquire, heartbeat, reclaim, error reschedule) are single statements with a fresh snapshot.
- `finish` is safe to call again in a retried transaction (last call wins).

Supporting the stricter levels later needs at least: a blocker-head write instead of a lock (a lock-only row does not conflict under REPEATABLE READ), and an answer for the heartbeat writing the job row on a timer, which makes a handler transaction that took its snapshot before a renewal fail its fenced `UPDATE` with a serialization error.

## Implementation plan

Exploratory: built on one feature branch (as one or several commits) to see how the result looks before committing to it. The steps below are an order of work, not separate PRs. If it is kept, everything ships in one major release, since the `StateAdapter` contract changes are breaking for custom adapter authors.

### Step 1 — adapter primitives

1. `StateAdapter` types: `fence`; `timeoutMsByTypeName` (replacing `typeNames`) on `startJobAttempt`; drop `hasBlockers`/`hasBlockedJobs`; optional `txCtx` on worker-owned methods.
2. In-process, Postgres, SQLite adapters:
   - `startJobAttempt` sets `attempt_until`.
   - All-or-nothing fenced `completeJobs`/`continueJobs`/`rescheduleJobs`/`extendJobAttempt` (`RETURNING`-driven; SQLite continue: update first).
   - Reclaim stamps `last_attempt_at`/`last_attempt_error`.
3. Core: `completeChain` implementation always calls `unblockJobs`; `create-state-jobs.ts` keeps `lockBlockerChains` as the first statement (validate before any other write).
4. Current worker builds `timeoutMsByTypeName` once at start from its processors (no behaviour change: an atomic attempt's acquire stays uncommitted until it ends) and calls `getJobBlockers` unconditionally until step 2 replaces preloading with `getBlockers`.
5. Conformance: fence miss for wrong attempt / wrong worker / completed / missing; fenced miss writes nothing (job, head, continuation); same-worker re-acquire; lease set on acquire; autocommit acquire/extend/reclaim; blocker race in both orders without a caller pre-lock (replaces `complete-jobs.ts:422`).

### Step 2 — new processing model

1. Core worker:
   - Rewrite `worker/job-process.ts` around `finish`; `performJob` in `in-process-worker.ts` acquires with autocommit; reclaim without `withTransaction`.
   - `finish`: required tx, validate-before-write, one hook key per attempt (last call wins), no failure latch.
   - Commit detection and error path as in "Commit detection" (`handle-job-handler-error.ts` without `txCtx`, miss classifier).
   - Heartbeat runs until the handler ends, never awaited by `finish`; renewal miss and attempt-lost listener share the miss classifier (own committed `finish` → no-op stop).
   - Delete `helpers/transaction-context.ts`, `helpers/savepoint-context.ts` (+ specs), `implementation/refetch-job-locked.ts`; move `jobAttemptAlreadyCompleted`, `jobAttemptTakenByAnotherWorker`, `jobAttemptExpired` to the miss classifier.
2. Types: `AttemptHandler` → `({ signal, job, getBlockers, finish }) => Promise<AttemptFinishResult>` (`getBlockers` only for job types with blockers; `job.blockers` removed); middleware arity reduction; rewrite `AttemptConfig` TSDoc (`attempt-heartbeat.ts:6-10`, mentions atomic and staged).
3. Remove `withSavepoint` from `StateAdapter`, providers (pg, postgres-js, sqlite), `examples/state-postgres-postgres-js/src/provider.ts`, logging wrapper, spy/in-process helpers, conformance.
4. Observability: drop phase sub-spans in core and `@queuert/otel`.
5. Tests:
   - Delete `process-modes.test-suite.ts`; rewrite mode/savepoint parts of `process-error-handling`, `state-resilience`, `attempt-reclaimer` (new: reclaim after crash before first heartbeat), `worker` (middleware), `process`.
   - `finish` tests in the `process` suite: rollback after `finish`; `finish` rolled back in a user savepoint while the outer transaction commits; committed `finish({ reschedule })` followed by a throw; caught missing-blocker error leaves nothing written; retried transaction callback; handler returns without `finish`; handler throws after committed `finish`; lost ownership at `finish` rolls back user writes; renewal while the user's transaction holds the row; renewal miss after own committed `finish` is a no-op; `getBlockers` with and without `txCtx`; workerless takeover of a running job.
   - Mechanical `complete(async ({ finish }) => finish(x))` → `finish({ ...tx, transactionHooks, ...x })` across remaining suites/specs (~330 sites, ~30 files), `otel.spec.ts`, `nats.spec.ts`.

### Step 3 — docs, examples, release

1. Examples:
   - Rewrite `showcase-processing-modes` as a single-purpose "long work, then finish in your transaction" example, renamed per the examples naming convention in `code-style.md`.
   - Rewrite `showcase-error-recovery` (no savepoints) and `showcase-middleware` (`wrapHandler` only); update the `observability-otel` span tree.
   - `state-*` examples demo typed `tx` through `finish` instead of `prepare`; the `state-sqlite-*` examples show the lock requirement.
   - Mechanical rewrite elsewhere.
2. Benchmarks: `processing-capacity` drops `--process-mode` and adds a fan-in blocker scenario (head-bump cost); regenerate `type-complexity`; mechanical `memory-footprint`.
3. Docs:
   - Add an isolation-level section to `advanced/job-processing.mdx` (READ COMMITTED only, user-facing).
   - Rewrite `advanced/job-processing.mdx`, `guides/processing-reliability.md`, `guides/middleware.md`, `advanced/otel-tracing.md`; delete `guides/processing-modes.mdx`.
   - Update `adapters.mdx`, `custom-adapters.md` (new contract text), `postgres-internals.md`, `sqlite-internals.md`, `in-process-worker.mdx`, `otel-internals.md`, `core-concepts.md`, `guides/transaction-hooks.mdx`, `guides/timeouts.md`, `guides/workerless-completion.md`, `guides/error-handling.mdx`, `benchmarks.md`, `examples.md`, comparison pages, all handler samples, root `README.md`, `code-style.md:169`.
   - Design docs: rewrite samples in `batched-processors.md`, `builtin-cleanup.md`, `unbounded-blockers.md`; update `worker-liveness.md` (see below).
4. Changesets: one `major` changeset (core, postgres, sqlite, otel), including "errors after a committed `finish` no longer roll back the completion", and that only READ COMMITTED is supported. Drop or rewrite the unreleased `step-transaction.md`, `attempt-finalization-rework.md`, `reschedule-terminal-outcome.md`, `savepoint-skip-release.md`; reword `abort-span-otel.md`, `wrap-handler-error-visibility.md`, `concrete-adapter-middleware.md`.
5. `TODO.md`: add this epic; it unblocks "Unify workerless and worker tracing".

## Interplay with other designs

- **Worker liveness** (`design/worker-liveness.md`): this change lands first. Liveness later replaces the per-attempt lease (`attempt_until`, `extendJobAttempt`, `reclaimExpiredJobAttempt`) with a per-worker lease; the parts of step 1 that touch those three are deliberately minimal because they are replaced then. The `attempt` fence, all-or-nothing writes and commit detection carry over unchanged. Its reclaim (`:145-160`, `FOR SHARE` gate plus a second statement in one transaction) conflicts with "no queuert-owned transactions" and must be redesigned as single conditional statements. It must also reclaim a `running` job whose worker is alive but no longer runs that attempt (the fast-path hole in "Commit detection"), for example by having the worker heartbeat list its in-flight attempts.
- **Built-in cleanup / unbounded blockers / batched processors**: samples move from `prepare`/`step`/`complete`/staged to `finish` in the user's transaction.
- **Abort reason consolidation** (TODO): same files; can ride along in step 2.

## Follow-ups (not in this change)

- Unify workerless and worker tracing (drop `completeJobSpan`).
- `wrapFinish` middleware hook (runs inside the user's transaction before the fenced write). Left out until a concrete use appears: adding an optional hook later is non-breaking, and today's candidates (audit rows, `SET LOCAL` tenant context) are doable in the handler, which holds `tx` right before `finish`.
- Redesign `transactionHooks` for restarted transactions. One hooks scope around a retry loop keeps every try's buffered events (`createChain`, `rescheduleJobs`, …), so events from rolled-back tries get flushed. This change only makes `finish` itself retry-safe (last call wins). Sketch of the general fix: `transactionHooks.reset()` called at the start of each try — `withTransactionHooks(async (transactionHooks) => db.transaction(async (tx) => { transactionHooks.reset(); … }))`. It discards everything buffered so far (each hook's `discard` runs, as on rollback), so only the committing try's events flush. Forgetting it degrades to today's behaviour. Rule: `withTransactionHooks` wraps only the transaction, since a reset also drops events buffered before it. Once it lands, `finish` can drop its own last-call-wins bookkeeping.
- Non-SQL state adapters (out of scope; nothing here is designed around them).

## Decisions

1. **No transaction helper.** Users write `withTransactionHooks` + their own `db.transaction` (hooks outside the transaction). The pattern and the SQLite lock requirement are documented, not wrapped.
2. **`TransactionHooks.withSavepoint` / `createSavepoint` stay** as user-facing API, though core no longer uses them internally. The heartbeat does not depend on them.
3. **No blocker preloading.** The handler reads blockers on demand with `getBlockers`.
4. **No-`finish` return is a handler error** (backoff, failure events), unchanged from today.
5. **Reclaim's `last_attempt_error`** is a fixed `JobAttemptExpiredError: …` string, no new error class.
