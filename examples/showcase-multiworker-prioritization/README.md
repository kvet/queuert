# Multi-Worker Prioritization Showcase

Demonstrates how to reserve worker capacity for an urgent workload by
partitioning job types across workers. Queuert has no built-in `priority`
field — prioritization is a consequence of giving an urgent workload its own
worker, whose slots cannot be consumed by other workloads.

## Scenarios

1. **Reserved capacity** — 10 bulk (marketing) jobs are enqueued first, then
   3 urgent (transactional) jobs arrive. The urgent worker picks them up
   immediately because it never observes marketing jobs.
2. **Cross-worker chain handoff** — a chain starts on the urgent worker
   (`alert.dispatch`) and continues on the bulk worker (`alert.archive`).
   Chains are not bound to a single worker; the handoff is database-mediated.

## Running

```bash
pnpm install
pnpm start
```
