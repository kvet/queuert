# Error Handling Showcase

Demonstrates error handling patterns in Queuert job chains.

## Scenarios

1. **Discriminated Unions**: Success/failure represented in typed outputs
2. **Compensation Pattern**: Failed job continues to rollback/refund job
3. **Explicit Rescheduling**: Rate-limited API calls with `rescheduleJob`

## Running

```bash
pnpm install
pnpm start
```
