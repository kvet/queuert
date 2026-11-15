# MySQL State Adapter (Prisma)

MySQL state storage via `@queuert/mysql` with Prisma ORM and its `@prisma/adapter-mariadb` driver adapter, which also connects to MySQL — job creation and completion inside application transactions.

The provider opens its interactive transactions with `isolationLevel: "ReadCommitted"`, the only isolation level Queuert supports. It also runs the application's own migrations (`src/migrations.ts`) with `createMysqlMigrator`, through raw queries (`$executeRaw`), since the `invoices` table is not in `schema.prisma`.

## Running

```bash
pnpm install
pnpm --filter example-mysql-state-prisma start
```

Requires Docker (uses testcontainers to start MySQL). `pnpm install` generates Prisma's TypeScript client.
