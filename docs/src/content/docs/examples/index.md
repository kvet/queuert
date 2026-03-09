---
title: Examples
description: Browsable index of all Queuert examples with source links.
sidebar:
  order: 100
---

All examples are self-contained and runnable. Each one demonstrates a single integration or pattern.

Source: [`examples/`](https://github.com/kvet/queuert/tree/main/examples)

## State Adapters

How to connect Queuert to your database using different ORMs and drivers.

### PostgreSQL

| Example                     | ORM / Driver                          | Source                                                                                                |
| --------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| state-postgres-kysely       | Kysely                                | [source](https://github.com/kvet/queuert/blob/main/examples/state-postgres-kysely/src/index.ts)       |
| state-postgres-drizzle      | Drizzle ORM                           | [source](https://github.com/kvet/queuert/blob/main/examples/state-postgres-drizzle/src/index.ts)      |
| state-postgres-prisma       | Prisma                                | [source](https://github.com/kvet/queuert/blob/main/examples/state-postgres-prisma/src/index.ts)       |
| state-postgres-pg           | pg (node-postgres)                    | [source](https://github.com/kvet/queuert/blob/main/examples/state-postgres-pg/src/index.ts)           |
| state-postgres-postgres-js  | postgres.js                           | [source](https://github.com/kvet/queuert/blob/main/examples/state-postgres-postgres-js/src/index.ts)  |
| state-postgres-multi-worker | Multiple workers sharing one database | [source](https://github.com/kvet/queuert/blob/main/examples/state-postgres-multi-worker/src/index.ts) |

### SQLite

| Example                     | ORM / Driver    | Source                                                                                                |
| --------------------------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| state-sqlite-better-sqlite3 | better-sqlite3  | [source](https://github.com/kvet/queuert/blob/main/examples/state-sqlite-better-sqlite3/src/index.ts) |
| state-sqlite-kysely         | Kysely          | [source](https://github.com/kvet/queuert/blob/main/examples/state-sqlite-kysely/src/index.ts)         |
| state-sqlite-drizzle        | Drizzle ORM     | [source](https://github.com/kvet/queuert/blob/main/examples/state-sqlite-drizzle/src/index.ts)        |
| state-sqlite-prisma         | Prisma          | [source](https://github.com/kvet/queuert/blob/main/examples/state-sqlite-prisma/src/index.ts)         |
| state-sqlite-sqlite3        | sqlite3 (async) | [source](https://github.com/kvet/queuert/blob/main/examples/state-sqlite-sqlite3/src/index.ts)        |

## Notify Adapters

How to set up real-time job notifications between client and workers.

| Example                     | Transport                              | Source                                                                                                |
| --------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| notify-redis-redis          | Redis (node-redis)                     | [source](https://github.com/kvet/queuert/blob/main/examples/notify-redis-redis/src/index.ts)          |
| notify-redis-ioredis        | Redis (ioredis)                        | [source](https://github.com/kvet/queuert/blob/main/examples/notify-redis-ioredis/src/index.ts)        |
| notify-nats-nats            | NATS                                   | [source](https://github.com/kvet/queuert/blob/main/examples/notify-nats-nats/src/index.ts)            |
| notify-postgres-pg          | PostgreSQL LISTEN/NOTIFY (pg)          | [source](https://github.com/kvet/queuert/blob/main/examples/notify-postgres-pg/src/index.ts)          |
| notify-postgres-postgres-js | PostgreSQL LISTEN/NOTIFY (postgres.js) | [source](https://github.com/kvet/queuert/blob/main/examples/notify-postgres-postgres-js/src/index.ts) |

## Patterns & Features

Job chain patterns, error handling, scheduling, and other core features.

| Example                   | What it demonstrates                                 | Source                                                                                              |
| ------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| showcase-chain-patterns   | Linear, branched, looped, and go-to chain execution  | [source](https://github.com/kvet/queuert/blob/main/examples/showcase-chain-patterns/src/index.ts)   |
| showcase-error-handling   | Discriminated unions, compensation, rescheduling     | [source](https://github.com/kvet/queuert/blob/main/examples/showcase-error-handling/src/index.ts)   |
| showcase-scheduling       | Delayed and time-scheduled jobs                      | [source](https://github.com/kvet/queuert/blob/main/examples/showcase-scheduling/src/index.ts)       |
| showcase-blockers         | Cross-chain job dependencies                         | [source](https://github.com/kvet/queuert/blob/main/examples/showcase-blockers/src/index.ts)         |
| showcase-chain-awaiting   | Awaiting chain completion programmatically           | [source](https://github.com/kvet/queuert/blob/main/examples/showcase-chain-awaiting/src/index.ts)   |
| showcase-chain-deletion   | Deleting job chains                                  | [source](https://github.com/kvet/queuert/blob/main/examples/showcase-chain-deletion/src/index.ts)   |
| showcase-processing-modes | Atomic vs staged processing modes                    | [source](https://github.com/kvet/queuert/blob/main/examples/showcase-processing-modes/src/index.ts) |
| showcase-queries          | Querying jobs and chains                             | [source](https://github.com/kvet/queuert/blob/main/examples/showcase-queries/src/index.ts)          |
| showcase-timeouts         | Job and chain timeouts                               | [source](https://github.com/kvet/queuert/blob/main/examples/showcase-timeouts/src/index.ts)         |
| showcase-slices           | Feature slices with merged registries and processors | [source](https://github.com/kvet/queuert/blob/main/examples/showcase-slices/src/index.ts)           |
| showcase-workerless       | Running without a worker (polling only)              | [source](https://github.com/kvet/queuert/blob/main/examples/showcase-workerless/src/index.ts)       |

## Logging

| Example     | Logger                  | Source                                                                                |
| ----------- | ----------------------- | ------------------------------------------------------------------------------------- |
| log-console | Built-in console logger | [source](https://github.com/kvet/queuert/blob/main/examples/log-console/src/index.ts) |
| log-pino    | Pino                    | [source](https://github.com/kvet/queuert/blob/main/examples/log-pino/src/index.ts)    |
| log-winston | Winston                 | [source](https://github.com/kvet/queuert/blob/main/examples/log-winston/src/index.ts) |

## Validation

Input/output validation with different schema libraries.

| Example            | Library | Source                                                                                       |
| ------------------ | ------- | -------------------------------------------------------------------------------------------- |
| validation-zod     | Zod     | [source](https://github.com/kvet/queuert/blob/main/examples/validation-zod/src/index.ts)     |
| validation-arktype | ArkType | [source](https://github.com/kvet/queuert/blob/main/examples/validation-arktype/src/index.ts) |
| validation-valibot | Valibot | [source](https://github.com/kvet/queuert/blob/main/examples/validation-valibot/src/index.ts) |
| validation-typebox | TypeBox | [source](https://github.com/kvet/queuert/blob/main/examples/validation-typebox/src/index.ts) |

## Observability & Dashboard

| Example            | What it demonstrates              | Source                                                                                       |
| ------------------ | --------------------------------- | -------------------------------------------------------------------------------------------- |
| observability-otel | OpenTelemetry tracing and metrics | [source](https://github.com/kvet/queuert/blob/main/examples/observability-otel/src/index.ts) |
| dashboard          | Web dashboard UI with SQLite      | [source](https://github.com/kvet/queuert/blob/main/examples/dashboard/src/index.ts)          |

## Benchmarks

| Benchmark                  | What it measures                   | Source                                                                                                 |
| -------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| benchmark-memory-footprint | Memory usage under load            | [source](https://github.com/kvet/queuert/blob/main/benchmarks/benchmark-memory-footprint/src/index.ts) |
| benchmark-type-complexity  | Type-checking cost across patterns | [source](https://github.com/kvet/queuert/blob/main/benchmarks/benchmark-type-complexity/src/index.ts)  |
