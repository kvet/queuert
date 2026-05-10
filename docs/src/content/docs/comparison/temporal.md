---
title: Temporal
description: How Queuert relates to Temporal — different categories that overlap on multi-step durable work.
sidebar:
  order: 3
---

[Temporal](https://temporal.io) and Queuert both express multi-step durable work, but they're different categories of tool. Temporal is a distributed workflow platform; Queuert is a job-chain library. Picking between them is mostly a question of how heavyweight a tool the problem actually warrants.

> Compared versions: Queuert `0.12.0` and the Temporal TypeScript SDK `1.17.1`.

## What Temporal is

Temporal is a **distributed durable-execution platform**. The mental model is workflow functions that run forever — deterministically, replayable from event history — execute side effects via separately-deployed Activities, and survive any crash by being replayed from their persistent history. Workflows can wait for hours or days, accept signals from outside, expose queries on their state, and spawn child workflows. Cross-language: official SDKs in Go, Java, Python, .NET, TypeScript, PHP, Ruby — all sharing the same server.

You operate (or rent via Temporal Cloud) a separate Temporal server cluster — frontend, matching, history, and worker services backed by Cassandra, MySQL, or Postgres. Your application contains an SDK that polls task queues over gRPC, executes workflow code in a sandbox VM, and runs activities directly.

## What Queuert is

Queuert is a **job-chain library** — durable, typed background work in your database. Job chains compose like Promise chains (`.then`, `Promise.all`), but they survive crashes and commit with your transactions.

The unit is a typed **chain** of jobs of (potentially different) types, where each job's `continueWith` enqueues the next one in the same chain. Inputs, outputs, continuations, and blockers are inferred end-to-end via `defineJobTypes`. Chains start _inside_ your DB transactions, so the work that follows a write commits-or-rolls-back with the data that triggered it.

No separate cluster. No deterministic replay. No event-history reconstruction. Just typed jobs in a couple of tables next to your domain data.

## Different tools — overlapping problem space

Temporal and Queuert come from different starting points and end up at different shapes:

- **Temporal** is a workflow platform. It trades operational complexity (a server cluster, bundled workflow code, a determinism contract) for unbounded durability — workflows can `await sleep('30 days')` and survive arbitrary crashes / redeploys — plus rich runtime interaction (signals / queries / updates) and cross-language workflows.
- **Queuert** is a job-chain library. It trades those things away for "you just have a Postgres" — no cluster to operate, no determinism constraint, no separate durability tier — and wins back transactional enqueue and structural simplicity.

Both can express multi-step durable work that finishes in seconds-to-minutes. They diverge sharply outside that range: Temporal makes month-long sleeping workflows trivial; Queuert doesn't try to.

## What Temporal is good at

- **In-line durable awaits.** A workflow function can `await sleep('30 days')` or `await condition(...)` literally inside its body and pick up where it left off — call stack restored — after a server restart, deploy, or region failover. Event-sourced replay makes this work. (Queuert can also span 30-day chains by scheduling the next step in the future; the difference is the programming model — "schedule the next step" vs. "await inside the same function.")
- **Rich runtime interaction.** Signals (fire-and-forget messages into a running workflow), queries (synchronous read of state), updates (RPC-shaped mutations with return values) are first-class.
- **Cross-language workflows.** A workflow defined in Go can call activities written in TypeScript and Python — same server, same task queues.
- **Built-in scheduling and child workflows.** Server-managed cron schedules with overlap policies, child workflows with parent-close policies, continue-as-new for unbounded loops.
- **Battle-tested at scale.** Production-deployed at Stripe, Snap, Coinbase, and many others.

These are what a _distributed durable-execution platform_ should be good at.

## What Queuert is good at

- **Chained execution of typed jobs.** Multi-step work as a typed sequence; inputs, outputs, continuations, and blockers infer end-to-end via `defineJobTypes`. Renames are compiler-checked.
- **Transactional consistency, by design.** `startChain` enqueues inside your DB transaction; handler completion + next-step `continueWith` commit in the same transaction as your domain writes. For DB-bound work, no outbox at enqueue and no idempotency-key ritual at processing — both halves are structural, not application discipline.
- **Plain TypeScript handlers.** No determinism constraint, no separate workflow bundle, no "you can't call `Date.now()` here." Job handlers are normal Node code that does normal Node things.
- **Operational simplicity.** No cluster to run, no separate persistence tier, no bundling step. Your application's Postgres is the entire backing store.
- **Database as the system of record.** Chain state lives next to your domain data. Joins, foreign keys, transactional consistency — all available.

These are what a _job-chain library_ should be good at.

## Differences worth knowing about

A few practical differences:

- **Where state lives.** Temporal owns workflow state in its server cluster (Cassandra / MySQL / Postgres). Queuert keeps chain state in your application's DB. This affects everything downstream — backups, observability, joins, transactions.
- **Transactional consistency.** Because Temporal state lives elsewhere, both ends require application discipline. _Enqueue:_ starting a workflow is a gRPC call to the Temporal Service, not a DB transaction. Temporal staff describe the dual-write trap explicitly in [their own forum](https://community.temporal.io/t/what-is-recommended-approach-on-starting-workflow-in-transaction/16248): *"this pattern will start the workflow even if the database needs to abort and retry the database transaction, leaving you in an inconsistent state where the workflow has started but the database doesn't know that happened."* _Processing:_ activities are at-least-once — Temporal's [Activity Definition](https://docs.temporal.io/activity-definition) docs state *"You should always make your business logic Activities idempotent in Temporal. Because Activities may be retried, these functions may be executed more than once."* The Temporal-blessed workaround is "workflow as the source of truth": start the workflow first, then write to the DB from inside an activity. That's a real architectural choice — it inverts the assumption many applications start from (that the DB is the system of record). With Queuert, both halves commit inside your DB transaction; the precondition is that your DB *is* the SoT for the data your handlers touch.
- **Determinism.** Temporal workflow code must be deterministic; you can't call `Date.now()`, `Math.random()`, `fetch`, or use plain `setTimeout`. Replay relies on this. Queuert handlers are plain TypeScript with no such constraint.
- **Long durable waits.** Temporal can `await sleep('30 days')` and survive crashes / deploys. Queuert can schedule the next attempt for a future time, but doesn't carry an awaiting call-stack across that wait.
- **Runtime interaction.** Temporal's signals / queries / updates are first-class. Queuert exposes `triggerJob` and `completeChain` but doesn't model an externally-interactive running process.
- **Versioning.** Bumping workflow code mid-flight in Temporal requires explicit `patched` / `getVersion` discipline. In Queuert, deploying new code doesn't risk replay drift because there's no replay.
- **Operational footprint.** Temporal: a multi-service cluster (frontend / matching / history / worker) plus Cassandra-class persistence, or pay for Temporal Cloud. Queuert: your existing Postgres.

## Choosing between them

The decision is about scale and shape:

**Reach for Temporal when:**

- You need long-lived workflows that survive arbitrary failures and run for days, weeks, or months.
- You need rich runtime interaction with running workflows — signals, queries, updates.
- You need cross-language workflows or activities (Go / Java / Python / .NET / TS / PHP / Ruby).
- The operational complexity of a separate cluster (or paying for Temporal Cloud) is acceptable.
- The determinism constraint and workflow bundling step are acceptable trade-offs for what you get.

**Reach for Queuert when:**

- Your work is chain-shaped and bounded — finishes in seconds-to-minutes per chain.
- You want transactional enqueue with your DB.
- You don't want to operate (or pay for) a separate workflow cluster.
- Plain TypeScript handlers with no determinism contract are worth more than long-lived `await sleep('30d')`.
- Your DB is the system of record and you want chain state living next to your domain data.

Both can express multi-step durable work. The difference is whether you need a workflow platform with replay and signals, or a small library that fits in a few tables next to your data.
