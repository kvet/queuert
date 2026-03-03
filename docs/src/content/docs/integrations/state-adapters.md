---
title: State Adapters
description: PostgreSQL and SQLite database adapters.
sidebar:
  order: 1
---

State adapters abstract database operations for job persistence. They handle job creation, status transitions, leasing, and queries. Queuert provides two state adapters: PostgreSQL for production workloads and SQLite for lightweight or embedded use cases.

## PostgreSQL

**Package:** `@queuert/postgres`

Recommended for production. Supports horizontal scaling with database-level locking (`FOR UPDATE SKIP LOCKED`), writeable CTEs for atomic batch operations, and all Queuert features including concurrent multi-worker deployments.

```bash
npm install @queuert/postgres
```

### Supported ORMs and drivers

| ORM / Driver | Example                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| Raw pg       | [state-postgres-pg](https://github.com/kvet/queuert/tree/main/examples/state-postgres-pg)                   |
| postgres.js  | [state-postgres-postgres-js](https://github.com/kvet/queuert/tree/main/examples/state-postgres-postgres-js) |
| Prisma       | [state-postgres-prisma](https://github.com/kvet/queuert/tree/main/examples/state-postgres-prisma)           |
| Drizzle      | [state-postgres-drizzle](https://github.com/kvet/queuert/tree/main/examples/state-postgres-drizzle)         |
| Kysely       | [state-postgres-kysely](https://github.com/kvet/queuert/tree/main/examples/state-postgres-kysely)           |

## SQLite

**Package:** `@queuert/sqlite`

Experimental. Suitable for local development, CLI tools, and embedded applications. SQLite's exclusive transaction locking model serializes all writes, so batch operations use sequential queries within a single transaction rather than writeable CTEs.

```bash
npm install @queuert/sqlite
```

### Supported drivers

| Driver         | Example                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| better-sqlite3 | [state-sqlite-better-sqlite3](https://github.com/kvet/queuert/tree/main/examples/state-sqlite-better-sqlite3) |
| sqlite3        | [state-sqlite-sqlite3](https://github.com/kvet/queuert/tree/main/examples/state-sqlite-sqlite3)               |
| Prisma         | [state-sqlite-prisma](https://github.com/kvet/queuert/tree/main/examples/state-sqlite-prisma)                 |
| Drizzle        | [state-sqlite-drizzle](https://github.com/kvet/queuert/tree/main/examples/state-sqlite-drizzle)               |
| Kysely         | [state-sqlite-kysely](https://github.com/kvet/queuert/tree/main/examples/state-sqlite-kysely)                 |

## State Provider

A State Provider bridges your database client (Kysely, Drizzle, Prisma, raw drivers, etc.) with the state adapter. You implement a simple interface that provides transaction handling and SQL execution:

- **`runInTransaction`** -- Manages connection acquisition and transaction lifecycle. The callback receives a transaction context representing an active transaction.
- **`executeSql`** -- Executes SQL statements. When a transaction context is provided, uses that connection; when omitted, acquires and releases its own connection from the pool.

Each example linked above demonstrates a complete State Provider implementation for its corresponding ORM or driver.

## Multi-worker deployment

For horizontal scaling, multiple worker processes can share the same PostgreSQL database. Workers coordinate via `FOR UPDATE SKIP LOCKED` -- no external coordination required.

See [state-postgres-multi-worker](https://github.com/kvet/queuert/tree/main/examples/state-postgres-multi-worker) for an example spawning multiple worker processes sharing a PostgreSQL database.

## See Also

- [Adapter Architecture](/queuert/advanced/adapters/) — StateAdapter design, context architecture, and provider interfaces
- [Horizontal Scaling](/queuert/guides/horizontal-scaling/) — Multi-worker deployment guide
