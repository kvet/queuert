# Scheduling Showcase

Recurring job patterns without external cron.

Scenarios: loop chains with scheduled delays, idempotent scheduling via deduplication, time-windowed (`windowMs`) rate limiting.

## Running

```bash
bun install
bun run --filter example-showcase-scheduling start
```
