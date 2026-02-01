# Console Logging Example

This example demonstrates how to use Queuert's built-in console logging for development and debugging.

## What it shows

1. Using `createConsoleLog()` for simple console output
2. Job lifecycle events logged automatically
3. Error logging with retry demonstrations

## Key points

- `createConsoleLog()` is the simplest logging option, ideal for development
- For production, consider structured logging with [Pino](../log-pino) or [Winston](../log-winston)
- Logging is optional - Queuert operates silently by default

## Key files

- `src/index.ts` - Demo with console logging setup

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter example-log-console start
```
