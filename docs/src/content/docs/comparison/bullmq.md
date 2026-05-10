---
title: BullMQ
description: How Queuert relates to BullMQ — different tools for different shapes of background work.
sidebar:
  order: 2
---

[BullMQ](https://github.com/taskforcesh/bullmq) is the most established Redis-backed job queue in the Node.js ecosystem. Queuert and BullMQ both run background work, but they sit on different storage tiers and approach the problem from different categories.

> Compared versions: Queuert `0.12.0` and BullMQ `5.76.6`.

## What BullMQ is

BullMQ is a **Redis-backed job queue**. The mental model is messages on Redis lists and sorted sets, moved between states by atomic Lua scripts. Workers block on `BZPOPMIN` and process jobs in process or in sandboxed child processes. Comes with priority, rate limiting, parent/child flows (`FlowProducer`), repeatable jobs / cron, sandbox isolation, and cross-language workers (Python, Elixir, PHP) that share the same Lua scripts.

You install it, point it at Redis, create queues, and `add` jobs. Workers either run in your process or in sandboxed child processes.

## What Queuert is

Queuert is a **job-chain library** — durable, typed background work in your database. Job chains compose like Promise chains (`.then`, `Promise.all`), but they survive crashes and commit with your transactions.

The unit isn't a message on a queue — it's a typed **chain** of jobs of (potentially different) types, where each job's `continueWith` enqueues the next one in the same chain. Inputs, outputs, continuations, and blockers are inferred end-to-end via `defineJobTypes`. Chains start _inside_ your DB transactions, so the work that follows a write commits-or-rolls-back with the data that triggered it.

Queuert sits between job queues and workflow engines: a one-job chain _is_ a queue; a multi-step chain with blockers is closer to a workflow. Neither label fully fits — which is why the canonical term is "job-chain library."

## They aren't directly comparable

BullMQ and Queuert run on different storage tiers and model different problems:

- **Queue concepts** like priority, rate limiting, sandboxed processors, and atomic Lua scripts are central to BullMQ because BullMQ is a high-throughput Redis queue. They're absent from Queuert because Queuert isn't modeling messages-on-Redis — it's modeling chained workflows tied to DB transactions.
- **Chain concepts** like typed continuations, blocker DAGs, and transactional enqueue tied to your DB are central to Queuert because Queuert is a job-chain library that lives in your DB. They're absent from BullMQ because BullMQ lives in Redis, separate from your domain data.

The narrow overlap is "both let you defer work into the background." Beyond that, the storage model and the shape diverge.

## What BullMQ is good at

- **Speed.** Redis lists/sorted sets and Lua-script atomicity make BullMQ the fastest path among Node queue libraries on raw throughput and wakeup latency. `BZPOPMIN` typically wakes in sub-millisecond.
- **Sandboxed processors.** Pass a `processFile` path; BullMQ runs handlers in separate Node processes (or worker threads) via a child pool. Real isolation and crash containment.
- **Cross-language workers.** Python, Elixir, and PHP clients share the same Lua scripts. The Redis state is the contract.
- **Rich queue primitives.** Priority (0–2,097,152), rate limiting (per queue, per key), parent/child flows via `FlowProducer`, repeat / cron schedules, deduplication windows.
- **Mature ecosystem.** Bull Board (third-party OSS dashboard), Taskforce.sh dashboards (paid), proxy package for serverless, broad deployment.

These are what a _Redis queue_ should be good at, and BullMQ invests heavily in them.

## What Queuert is good at

- **Chained execution of typed jobs.** A chain is a typed sequence: `"send-email"` continues with `"log-sent"` continues with `"update-user-status"`. Each step's input/output type is inferred from the previous step's `continueWith`. Renames are compiler-checked.
- **Fan-in via blockers.** "Wait for these N independent chains to finish, then run X" is a typed primitive backed by a `job_blocker` table — not glue code.
- **Transactional consistency, by design.** `startChain` enqueues inside your DB transaction; handler completion + next-step `continueWith` commit in the same transaction as your domain writes. For DB-bound work, no outbox at enqueue and no idempotency-key ritual at processing — both halves are structural, not application discipline.
- **Database as the system of record.** Workflow state lives in the same DB as your domain data. No separate store, no separate consistency model, no separate operational target.
- **Pluggable transports.** State (Postgres / SQLite / in-process) and notify (LISTEN/NOTIFY / Redis / NATS / polling) are independent.

These are what a _job-chain library_ should be good at, and Queuert is built around them.

## Differences worth knowing about

A few practical differences:

- **Storage tier.** BullMQ requires Redis; durability depends on your Redis configuration (RDB / AOF / fsync settings). Queuert uses Postgres or SQLite; durability is whatever your DB gives you.
- **Wakeup mechanism.** BullMQ's `BZPOPMIN` blocking pop wakes in sub-millisecond. Queuert's `LISTEN/NOTIFY` (or Redis pub/sub, or NATS) wakes in tens of milliseconds.
- **Transactional consistency.** BullMQ's queue lives in Redis, separate from your domain DB — so both ends require application discipline. _Enqueue:_ dual-write between your DB and Redis is structural; transactional `add` isn't possible. _Processing:_ BullMQ's [Important Notes](https://docs.bullmq.io/bull/important-notes) describe at-least-once execution and warn that on lock expiration the job is "double processed" — handlers must be idempotent. With Queuert, both halves commit inside your DB transaction; for DB-bound work, no outbox and no idempotency-key ritual.
- **Sandboxing.** BullMQ provides first-class sandboxed processors. Queuert runs handlers in your worker process; isolation is your application's concern.
- **Cross-language workers.** BullMQ has SDKs in several languages sharing the same Redis state. Queuert is Node-only.
- **Failure shape.** BullMQ's `failed` sorted set acts as the dead-letter queue; you re-process via `job.retry()`. Queuert leaves the error as data on the chain (`last_attempt_error`) and lets the application decide what to do next.

## Choosing between them

**Reach for BullMQ when:**

- You already operate Redis and accept it as durable storage (or are fine with the loss-on-crash trade-off).
- You need sub-millisecond wakeup latency and high raw throughput.
- You want sandboxed processors for crash containment, untrusted handlers, or memory limits.
- You need cross-language workers (Python / Elixir / PHP).
- Your problem is naturally queue-shaped: messages, lanes, routing, rate limits.

**Reach for Queuert when:**

- Your problem is naturally chain-shaped: typed multi-step sequences where this job continues with that job, possibly waiting on others.
- You want enqueue to commit-or-rollback structurally with the data that triggered it.
- Your DB is already the system of record and you'd rather not introduce a second durable store.
- Sub-second (not sub-millisecond) wakeup latency via `LISTEN/NOTIFY` (or Redis / NATS) is enough.

If you genuinely need both — high-throughput queue work _and_ chain-shaped sequences tied to your DB — those are different concerns and deserve different tools. They aren't substitutes.
