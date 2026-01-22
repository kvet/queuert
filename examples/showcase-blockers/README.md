# Blockers Showcase

Demonstrates how jobs can depend on other job chains to complete before starting.

## Scenarios

1. **Fan-out/Fan-in**: Multiple fetch jobs run in parallel, aggregate waits for all
2. **Fixed Slots**: Job requires exactly two specific prerequisite jobs

## Running

```bash
pnpm install
pnpm start
```
