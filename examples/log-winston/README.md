# Winston Logging Example

This example demonstrates how to integrate Queuert with Winston for structured logging.

## What it shows

1. Creating a custom `Log` adapter for Winston
2. Proper error handling in log metadata
3. Structured log output with job lifecycle events

## Key files

- `src/log.ts` - The Winston log adapter implementation
- `src/index.ts` - Demo that runs jobs and shows log output

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter @queuert/log-winston start
```
