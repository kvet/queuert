# @queuert/mysql

MySQL/MariaDB state adapter for [Queuert](https://github.com/kvet/queuert) - a TypeScript library for database-backed job queues.

## What does this do?

[Queuert](https://github.com/kvet/queuert) uses adapters to store job state and coordinate workers. This package provides:

**State Adapter** - Stores jobs in MySQL tables:

- Creating and updating jobs with full ACID transactions
- Tracking job status (`pending` → `running` → `completed`)
- Managing job leases with `FOR UPDATE SKIP LOCKED` for distributed workers
- Storing job chains and blocker relationships

**No Notify Adapter** - MySQL does not have built-in pub/sub like PostgreSQL's LISTEN/NOTIFY. Use an external notify adapter:

- `createInProcessNotifyAdapter()` from `queuert/internal` for single-process deployments
- `@queuert/redis` for Redis pub/sub
- `@queuert/nats` for NATS messaging

## Requirements

- **MySQL 8.0.1+** or **MariaDB 10.6+** (required for `FOR UPDATE SKIP LOCKED`)
- A MySQL client library (`mysql2` recommended)

## When to use MySQL

- **Existing MySQL infrastructure** - No need to add PostgreSQL if you already use MySQL
- **Familiar tooling** - Use your existing MySQL administration workflows
- **Managed MySQL services** - AWS RDS MySQL, Google Cloud SQL, PlanetScale, etc.

For new deployments, consider [PostgreSQL](https://github.com/kvet/queuert/tree/main/packages/postgres) which includes a built-in notify adapter.

## Installation

```bash
npm install @queuert/mysql mysql2
```

**Peer dependencies:** `queuert`

## Quick Start

```typescript
import { createQueuertClient, createConsoleLog, defineJobTypes } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";
import { createMysqlStateAdapter } from "@queuert/mysql";

const jobTypes = defineJobTypes<{
  "send-email": { entry: true; input: { to: string }; output: { sent: true } };
}>();

const stateAdapter = await createMysqlStateAdapter({
  stateProvider: myMysqlStateProvider, // You provide this - see below
});

// MySQL has no built-in notify - use in-process for single-server, or Redis/NATS for distributed
const notifyAdapter = createInProcessNotifyAdapter();

const client = await createQueuertClient({
  stateAdapter,
  notifyAdapter,
  jobTypeRegistry: jobTypes,
  log: createConsoleLog(),
});
```

## Configuration

### State Adapter

```typescript
const stateAdapter = await createMysqlStateAdapter({
  stateProvider: myMysqlStateProvider,
  tablePrefix: 'queuert_',              // Table prefix (default: "queuert_")
  idType: 'CHAR(36)',                   // SQL type for job IDs (default: "CHAR(36)")
  idGenerator: () => crypto.randomUUID(), // ID generation function
  connectionRetryConfig: { ... },       // Retry config for transient errors
  isTransientError: (error) => ...,     // Custom transient error detection
});
```

## State Provider

You need to implement a state provider that bridges your MySQL client (`mysql2`, Drizzle, Prisma, etc.) with this adapter. The provider handles transaction management and SQL execution.

```typescript
import mysql from "mysql2/promise";
import { type MysqlStateProvider } from "@queuert/mysql";

const pool = mysql.createPool({ uri: "mysql://..." });

type DbContext = { connection: mysql.PoolConnection };

const stateProvider: MysqlStateProvider<DbContext> = {
  runInTransaction: async (fn) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await fn({ connection });
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
  executeSql: async ({ txContext, sql, params }) => {
    if (txContext) {
      const [rows] = await txContext.connection.query(sql, params);
      return rows as any[];
    }
    const [rows] = await pool.query(sql, params);
    return rows as any[];
  },
};
```

## Exports

### Main (`.`)

- `createMysqlStateAdapter` - Factory to create MySQL state adapter
- `MysqlStateAdapter` - Type for the MySQL state adapter
- `MysqlStateProvider` - Type for the state provider interface (you implement this)
- `mysqlLiteral` - SQL literal escaping utility for ORM compatibility

### Testing (`./testing`)

- `extendWithStateMysql` - Test context helper for MySQL state adapter

## Limitations

1. **MySQL 8.0+ required** - Older versions lack `FOR UPDATE SKIP LOCKED` and CTEs
2. **No built-in notifications** - Must use external notify adapter (Redis, NATS, or in-process)
3. **Table prefix only** - MySQL doesn't support PostgreSQL-style schemas within a database

## Documentation

For full documentation, examples, and API reference, see the [main Queuert README](https://github.com/kvet/queuert#readme).
