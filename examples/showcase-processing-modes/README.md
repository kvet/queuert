# Processing Modes Showcase

Demonstrates processing modes through an order fulfillment workflow.

## Scenarios

1. **Auto-Setup Atomic**: Just call `complete()` directly — simplest path, single transaction
2. **Staged Mode**: Use `prepare()` when external API calls happen between transactions
3. **Auto-Setup Staged**: Async work before `complete()` without explicit `prepare()`

## Running

```bash
pnpm install
pnpm start
```
