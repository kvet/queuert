# Console Logging Example

Queuert's built-in `createConsoleLog()` for simple console output.

## Running

```bash
bun install
bun run --filter example-log-console start
```

For per-job contextual logging (child logger bound to `{jobId, typeName, attempt, workerId}`), see [log-pino](../log-pino) and [log-winston](../log-winston), which add an `attemptMiddleware`.
