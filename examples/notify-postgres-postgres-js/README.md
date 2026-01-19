# PostgreSQL Notify Adapter (postgres-js)

This example demonstrates the PostgreSQL notify adapter with postgres-js.

## What it demonstrates

- PostgreSQL LISTEN/NOTIFY notifications via `@queuert/postgres`
- Integration with postgres-js client
- Background job processing with `waitForJobChainCompletion`
- Main thread continues working while jobs process asynchronously

## postgres-js vs pg

The main differences when using postgres-js:

1. **Built-in LISTEN/NOTIFY**: Uses `sql.listen()` and `sql.notify()` methods directly
2. **Automatic connection management**: postgres-js manages a dedicated connection for LISTEN automatically
3. **Tagged template literals**: Uses `` sql`query` `` syntax for queries
4. **Cleaner unsubscribe**: `sql.listen()` returns an object with `unlisten()` method

## What it does

1. Starts PostgreSQL using testcontainers
2. Creates a postgres-js connection
3. Sets up a notify provider using postgres-js built-in LISTEN/NOTIFY
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
pnpm --filter example-notify-postgres-postgres-js start
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
