# PostgreSQL Notify Adapter (pg)

This example demonstrates the PostgreSQL notify adapter with pg (node-postgres).

## What it demonstrates

- PostgreSQL LISTEN/NOTIFY notifications via `@queuert/postgres`
- Integration with pg (node-postgres) client
- Background job processing with `waitForJobChainCompletion`
- Main thread continues working while jobs process asynchronously

## pg vs postgres-js

The main differences when using pg (node-postgres):

1. **Connection pool**: Uses `Pool` class with `.connect()` to acquire clients
2. **Notification events**: Client emits `'notification'` events with `{ channel, payload }` objects
3. **Parameterized queries**: Uses `client.query(sql, [params])` syntax

## What it does

1. Starts PostgreSQL using testcontainers
2. Creates a pg connection pool
3. Sets up a notify provider with dedicated LISTEN connection
4. Sets up Queuert with PostgreSQL notify adapter and in-process state adapter
5. Starts a worker that processes `generate_report` jobs
6. Queues a report generation job
7. **Main thread continues with other work** while the job processes
8. Waits for the report to complete using `waitForJobChainCompletion`
9. Cleans up resources

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter example-notify-postgres-pg start
```

## Example output

```
Starting PostgreSQL...
Requesting sales report...
Report queued! Continuing with other work...
Preparing email template...
Generating sales report...
Loading recipient list...
Waiting for report...
Report generated with 847 rows
Report ready! ID: RPT-1234567890, Rows: 847
Done!
```

Notice how the main thread and worker interleave - the main thread continues preparing while the worker processes the report in the background.
