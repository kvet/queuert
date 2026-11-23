# Console Logging Example

Queuert's built-in `createConsoleLog()` for simple console output.

## Running

```bash
pnpm install
pnpm --filter example-log-console start
```

For contextual logging (a child logger bound to the handler call's jobs as `jobAttempts`, each `{jobId, typeName, chainTypeName, attempt, workerId}`), see [log/pino](../pino) and [log/winston](../winston), which add an `attemptMiddleware`.
