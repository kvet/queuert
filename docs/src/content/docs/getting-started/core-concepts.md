---
title: Core Concepts
description: Jobs, chains, types, adapters, and workers.
sidebar:
  order: 3
---

### Job

An individual unit of work. Jobs have a lifecycle: (`blocked` →) `pending` → `running` → `completed`. Each job belongs to a Job Type and contains typed input/output. Jobs that depend on other chains start as `blocked` if any of those chains is still running, and become `pending` when their blockers complete (see [Job Blockers](/queuert/guides/job-blockers/)).

### Chain

A chain of linked jobs where each job can `continueWith` to the next - just like a Promise chain. In fact, a chain IS its head job, the same way a Promise chain IS the first promise. When you call `createChain`, the returned `chain.id` is the head job's ID. Continuation jobs share this `chainId` but have their own unique `id`. The chain completes when its final job completes without continuing.

### Job Type

Defines a named job type with its input/output types. Job types are registered with the client via `createClient`; their attempt handlers are supplied through `createProcessors` and run by workers. The attempt handler receives the job and context for completing or continuing the chain.

### State Adapter

Abstracts database operations for job persistence. The adapter handles job creation, status transitions, attempt tracking, and queries. Database-backed adapters run through a state provider you implement for your database client (Kysely, Drizzle, Prisma, raw pg, etc.), providing transaction handling and SQL execution. See [State Adapters](/queuert/integrations/state-adapters/) for the available backends, and the state provider for [PostgreSQL](/queuert/integrations/state-adapters/postgres/#state-provider) or [SQLite](/queuert/integrations/state-adapters/sqlite/#state-provider).

### Notify Adapter

Handles pub/sub notifications for efficient job scheduling. When a job is created, workers are notified immediately instead of polling. This reduces latency from seconds to milliseconds. Without one, workers poll. Some adapters run through a notify provider you implement for your pub/sub client, for publishing messages and subscribing to channels. See [Notify Adapters](/queuert/integrations/notify-adapters/) for the available backends, and the notify provider for [PostgreSQL](/queuert/integrations/notify-adapters/postgres/#notify-provider) or [Redis](/queuert/integrations/notify-adapters/redis/#notify-provider).

### Worker Runner

A worker runner, created with `createWorkerRunner`, processes jobs by polling for available work. It runs one worker at a time, a row in the `worker` table with a lease it keeps renewing, so its attempts can run however long they take. It reclaims the jobs of workers whose lease expired and handles retries with configurable backoff. See [Worker Runner](/queuert/how-it-works/worker-runner/) and [Job Processing](/queuert/how-it-works/job-processing/).

### Logging

By default, Queuert operates silently. Enable logging with `createConsoleLog()` for development, or implement a custom `Log` function for production (Pino, Winston, etc.). See [Logging](/queuert/integrations/logging/).

## What's next?

Now that you understand the building blocks, follow the guides in order:

1. **[Tx Hooks](/queuert/guides/tx-hooks/)** — How jobs are created inside database transactions (required for all usage)
2. **[Job Processing](/queuert/how-it-works/job-processing/)** — How an attempt runs and how `complete` commits its outcome in your transaction
3. **[Chain Patterns](/queuert/guides/chain-patterns/)** — Linear chains, branching, loops, and go-to patterns

For setting up your database and infrastructure, see [Integrations](/queuert/integrations/).
