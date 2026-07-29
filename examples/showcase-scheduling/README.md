# Scheduling Showcase

Recurring job patterns without external cron.

Scenarios: loop chains with scheduled delays, idempotent scheduling via deduplication, time-windowed (`windowMs`) rate limiting, triggering a future-scheduled job early with a locked read-modify-write.

## Running

```bash
bun install
bun run --filter example-showcase-scheduling start
```
