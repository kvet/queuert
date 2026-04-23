# Multi-Worker Prioritization Showcase

Reserving worker capacity for an urgent workload by partitioning job types across workers. Queuert has no built-in priority field — prioritization is a consequence of giving an urgent workload its own worker whose slots cannot be consumed by bulk work.

Scenarios: reserved capacity (urgent worker isolated from bulk backlog), cross-worker chain handoff.

## Running

```bash
bun install
bun run --filter example-showcase-multiworker-prioritization start
```
