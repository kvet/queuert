# MariaDB State Adapter (mariadb)

MariaDB state storage via `@queuert/mysql` with the official [`mariadb`](https://github.com/mariadb-corporation/mariadb-connector-nodejs) connector — job creation and completion inside application transactions.

The mariadb connector keeps no transaction flag, so the provider's `getTransaction` recognizes only transactions its own `withTransaction` opened: open the transactions you pass to Queuert with it, not with `connection.beginTransaction()`. Every transaction it opens runs at READ COMMITTED, where Queuert keeps its own work.

## Running

```bash
pnpm install
pnpm --filter example-mysql-state-mariadb start
```

Requires Docker (uses testcontainers to start MariaDB).
