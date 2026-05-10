---
title: Inngest
description: How Queuert relates to Inngest — different categories that overlap on multi-step durable work.
sidebar:
  order: 4
---

[Inngest](https://www.inngest.com) and Queuert both express multi-step durable work, but they're different categories of tool. Inngest is an event-driven workflow platform; Queuert is a job-chain library. Their starting points and deployment shapes are different.

> Compared versions: Queuert `0.12.0` and the Inngest SDK `inngest@4.3.0`.

## What Inngest is

Inngest is an **event-driven durable-function platform**. The mental model is events that trigger functions; each function is composed of `step.run` blocks whose results are persisted server-side. Functions execute inside HTTP handlers in your application — there's no worker process — with the Inngest server invoking your `serve()` adapter and re-invoking it as steps complete. Built-in primitives for concurrency, rate-limiting, throttling, debouncing, priority, cron, `step.sleep('30d')`, `step.waitForEvent`, and fan-out via subscribe.

You install the SDK, mount a `serve()` adapter at `/api/inngest`, and either rent the managed Inngest Cloud or operate the OSS Go server. Functions are defined in your app and discovered by the server when it pings your endpoint.

## What Queuert is

Queuert is a **job-chain library** — durable, typed background work in your database. Job chains compose like Promise chains (`.then`, `Promise.all`), but they survive crashes and commit with your transactions.

The unit is a typed **chain** of jobs of (potentially different) types, where each job's `continueWith` enqueues the next one in the same chain. Inputs, outputs, continuations, and blockers are inferred end-to-end via `defineJobTypes`. Chains start _inside_ your DB transactions, so the work that follows a write commits-or-rolls-back with the data that triggered it.

No separate server. No event-driven dispatch. No HTTP-handler execution shape. Just typed chains in a couple of tables next to your domain data, processed by a worker in your Node process.

## Different tools — overlapping problem space

Both can express multi-step durable work, but they start from different places:

- **Inngest** starts from events. You publish events; functions subscribe to them. Multiple functions can subscribe to the same event (fan-out). Long-lived workflows pause via `step.sleep` / `step.waitForEvent` and resume when conditions are met. Functions execute as HTTP request/response cycles invoked by the Inngest server.
- **Queuert** starts from database transactions. You write data and start a chain in the same transaction. Continuations propagate forward via `continueWith`. Workers in your process pull and execute jobs.

Both can model "a 5-step background workflow." The difference shows up in (1) how it's triggered, (2) where it executes, and (3) what runtime it requires.

## What Inngest is good at

- **Event-driven workflows.** Publishing an event can fan out to many subscribed functions. `step.waitForEvent('payment.completed', { match: '...' })` durably waits for a future event to arrive.
- **Long-lived durable waits.** `step.sleep('30 days')` survives restarts, redeploys, region failovers — the server handles re-invocation.
- **Rich orchestration knobs.** First-class concurrency limits (per-key, expression-keyed), rate limiting, throttling, debouncing, priority — directly on the function definition.
- **HTTP-handler execution shape.** Functions live next to your routes and run on whatever HTTP runtime you already have (Vercel, Cloudflare, Lambda, Express, etc.). No worker process to manage.
- **Hosted option.** Inngest Cloud handles the server-side concerns; the OSS Go server is the self-hosted alternative.
- **Cross-language SDKs.** TypeScript, Python, Go, Kotlin, Elixir, Rust.

These are what a _managed event-driven workflow platform_ should be good at.

## What Queuert is good at

- **Chained execution of typed jobs.** Multi-step work as a typed sequence; inputs, outputs, continuations, and blockers infer end-to-end via `defineJobTypes`. Renames are compiler-checked.
- **Transactional consistency, by design.** `startChain` enqueues inside your DB transaction; handler completion + next-step `continueWith` commit in the same transaction as your domain writes. For DB-bound work, no outbox at enqueue and no idempotency-key ritual at processing — both halves are structural, not application discipline.
- **Operational simplicity.** No platform to depend on, no service to operate. Your existing Postgres (or SQLite) is the entire backing store.
- **Database as the system of record.** Chain state lives next to your domain data. Same DB, same backups, same observability.
- **Plain in-process workers.** Handlers run in your Node process; closures over outer scope work normally; no per-step HTTP roundtrip cost.

These are what a _job-chain library_ should be good at.

## Differences worth knowing about

A few practical differences:

- **Trigger model.** Inngest is event-first: you `inngest.send({ name, data })` and matching functions run. Queuert is transaction-first: you `client.startChain({ typeName, input })` inside a DB transaction.
- **Where execution happens.** Inngest functions run in your HTTP handlers, invoked by the Inngest server. Queuert handlers run in your worker process, pulled from the DB.
- **Where state lives.** Inngest server (managed or self-hosted) owns step state and event histories. Queuert keeps everything in your application's DB.
- **Per-step cost.** Each Inngest `step.run` is an HTTP roundtrip to the Inngest server (sync checkpointing). Queuert does one DB transaction per attempt; a chain of 5 jobs is 5 DB transactions, no platform RTT.
- **Long durable waits.** Inngest's `step.sleep('30d')` and `step.waitForEvent` survive crashes / deploys. Queuert can schedule the next attempt for a future time, but doesn't carry an awaiting call-stack.
- **Transactional consistency.** Inngest state lives on the Inngest server — so both ends require application discipline. _Enqueue:_ `inngest.send` posts over HTTP independently of your DB transaction; dual-write is the default. _Processing:_ Inngest's own [Errors & Retries](https://www.inngest.com/docs/guides/error-handling) doc tells users *"a step inserting a new user to the database is not idempotent while a step upserting a user is"* — `step.run` is at-least-once until the result reaches the server. With Queuert, both halves commit inside your DB transaction; for DB-bound work, no outbox and no idempotency-key ritual.
- **Vendor / hosting story.** Inngest Cloud is the easy path; self-hosting the OSS server is possible but newer. Queuert has no vendor — your existing DB is the entire dependency.

## Choosing between them

**Reach for Inngest when:**

- Your work is naturally event-driven: webhooks fan out, long-pending workflows resume on a future event, durable sleeps measured in days.
- You want first-class concurrency / rate-limit / throttle / debounce knobs without writing them yourself.
- You're comfortable with Inngest Cloud (or operating the OSS server) as a dependency.
- HTTP-handler execution fits your runtime (Vercel / Cloudflare / Lambda / etc.).
- You can accept the dual-write story and use idempotency keys to make it safe.

**Reach for Queuert when:**

- Your work is naturally transaction-driven: this DB write commits, then this background work follows.
- You want enqueue to commit-or-rollback structurally with your DB transaction — no dual-write window.
- You don't want to depend on a SaaS or operate a separate workflow server.
- Plain TypeScript handlers in your worker process are simpler than per-step HTTP roundtrips.
- Your DB is the system of record and you want chain state living there too.

Both can express multi-step durable work. The forcing question is usually whether your problem is shaped more like "events trigger functions" or "transactions create chains" — and how comfortable you are with the platform/dependency that comes with the event-driven shape.
