# Scheduling Showcase

Recurring job patterns without external cron.

Scenarios: recurring jobs that start a new chain with a scheduled delay, deduplication of recurring job instances, triggering a future-scheduled job early with `rescheduleJob`, and rescheduling from a handler with `complete({ reschedule })`.

## Running

```bash
pnpm install
pnpm --filter example-showcase-scheduling start
```
