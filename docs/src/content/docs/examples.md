---
title: Examples
description: Browsable index of all Queuert examples with source links.
---

All examples are self-contained and runnable. Each one demonstrates a single integration or pattern.

Source: [`examples/`](https://github.com/kvet/queuert/tree/main/examples)

## State Adapters

How to connect Queuert to your database using different ORMs and drivers.

### PostgreSQL

| Example                                                                                                       | ORM / Driver                          |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [state-postgres-kysely](https://github.com/kvet/queuert/tree/main/examples/state-postgres-kysely)             | Kysely                                |
| [state-postgres-drizzle](https://github.com/kvet/queuert/tree/main/examples/state-postgres-drizzle)           | Drizzle ORM                           |
| [state-postgres-prisma](https://github.com/kvet/queuert/tree/main/examples/state-postgres-prisma)             | Prisma                                |
| [state-postgres-pg](https://github.com/kvet/queuert/tree/main/examples/state-postgres-pg)                     | pg (node-postgres)                    |
| [state-postgres-postgres-js](https://github.com/kvet/queuert/tree/main/examples/state-postgres-postgres-js)   | postgres.js                           |
| [state-postgres-multi-worker](https://github.com/kvet/queuert/tree/main/examples/state-postgres-multi-worker) | Multiple workers sharing one database |

### SQLite

| Example                                                                                                       | ORM / Driver    |
| ------------------------------------------------------------------------------------------------------------- | --------------- |
| [state-sqlite-better-sqlite3](https://github.com/kvet/queuert/tree/main/examples/state-sqlite-better-sqlite3) | better-sqlite3  |
| [state-sqlite-kysely](https://github.com/kvet/queuert/tree/main/examples/state-sqlite-kysely)                 | Kysely          |
| [state-sqlite-drizzle](https://github.com/kvet/queuert/tree/main/examples/state-sqlite-drizzle)               | Drizzle ORM     |
| [state-sqlite-prisma](https://github.com/kvet/queuert/tree/main/examples/state-sqlite-prisma)                 | Prisma          |
| [state-sqlite-sqlite3](https://github.com/kvet/queuert/tree/main/examples/state-sqlite-sqlite3)               | sqlite3 (async) |

## Notify Adapters

How to set up real-time job notifications between client and workers.

| Example                                                                                                       | Transport                              |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| [notify-redis-redis](https://github.com/kvet/queuert/tree/main/examples/notify-redis-redis)                   | Redis (node-redis)                     |
| [notify-redis-ioredis](https://github.com/kvet/queuert/tree/main/examples/notify-redis-ioredis)               | Redis (ioredis)                        |
| [notify-nats-nats](https://github.com/kvet/queuert/tree/main/examples/notify-nats-nats)                       | NATS                                   |
| [notify-postgres-pg](https://github.com/kvet/queuert/tree/main/examples/notify-postgres-pg)                   | PostgreSQL LISTEN/NOTIFY (pg)          |
| [notify-postgres-postgres-js](https://github.com/kvet/queuert/tree/main/examples/notify-postgres-postgres-js) | PostgreSQL LISTEN/NOTIFY (postgres.js) |

## Patterns & Features

Job chain patterns, error handling, scheduling, and other core features.

| Example                                                                                                   | What it demonstrates                                 |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [showcase-chain-patterns](https://github.com/kvet/queuert/tree/main/examples/showcase-chain-patterns)     | Linear, branched, looped, and go-to chain execution  |
| [showcase-error-handling](https://github.com/kvet/queuert/tree/main/examples/showcase-error-handling)     | Discriminated unions, compensation, rescheduling     |
| [showcase-scheduling](https://github.com/kvet/queuert/tree/main/examples/showcase-scheduling)             | Delayed and time-scheduled jobs                      |
| [showcase-blockers](https://github.com/kvet/queuert/tree/main/examples/showcase-blockers)                 | Cross-chain job dependencies                         |
| [showcase-chain-awaiting](https://github.com/kvet/queuert/tree/main/examples/showcase-chain-awaiting)     | Awaiting chain completion programmatically           |
| [showcase-chain-deletion](https://github.com/kvet/queuert/tree/main/examples/showcase-chain-deletion)     | Deleting job chains                                  |
| [showcase-processing-modes](https://github.com/kvet/queuert/tree/main/examples/showcase-processing-modes) | Atomic vs staged processing modes                    |
| [showcase-queries](https://github.com/kvet/queuert/tree/main/examples/showcase-queries)                   | Querying jobs and chains                             |
| [showcase-timeouts](https://github.com/kvet/queuert/tree/main/examples/showcase-timeouts)                 | Job and chain timeouts                               |
| [showcase-slices](https://github.com/kvet/queuert/tree/main/examples/showcase-slices)                     | Feature slices with merged registries and processors |
| [showcase-workerless](https://github.com/kvet/queuert/tree/main/examples/showcase-workerless)             | Running without a worker (polling only)              |

## Logging

| Example                                                                       | Logger                  |
| ----------------------------------------------------------------------------- | ----------------------- |
| [log-console](https://github.com/kvet/queuert/tree/main/examples/log-console) | Built-in console logger |
| [log-pino](https://github.com/kvet/queuert/tree/main/examples/log-pino)       | Pino                    |
| [log-winston](https://github.com/kvet/queuert/tree/main/examples/log-winston) | Winston                 |

## Validation

Input/output validation with different schema libraries.

| Example                                                                                     | Library |
| ------------------------------------------------------------------------------------------- | ------- |
| [validation-zod](https://github.com/kvet/queuert/tree/main/examples/validation-zod)         | Zod     |
| [validation-arktype](https://github.com/kvet/queuert/tree/main/examples/validation-arktype) | ArkType |
| [validation-valibot](https://github.com/kvet/queuert/tree/main/examples/validation-valibot) | Valibot |
| [validation-typebox](https://github.com/kvet/queuert/tree/main/examples/validation-typebox) | TypeBox |

## Observability & Dashboard

| Example                                                                                     | What it demonstrates              |
| ------------------------------------------------------------------------------------------- | --------------------------------- |
| [observability-otel](https://github.com/kvet/queuert/tree/main/examples/observability-otel) | OpenTelemetry tracing and metrics |
| [dashboard](https://github.com/kvet/queuert/tree/main/examples/dashboard)                   | Web dashboard UI with SQLite      |
