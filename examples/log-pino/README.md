# Pino Logging Example

This example demonstrates how to integrate Queuert with Pino for structured logging.

## What it shows

1. Creating a custom `Log` adapter for Pino
2. Proper error serialization (using Pino's `err` property for stack traces)
3. Structured log output with job lifecycle events

## Key files

- `src/log.ts` - The Pino log adapter implementation
- `src/index.ts` - Demo that runs jobs and shows log output

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter @queuert/log-pino start
```
