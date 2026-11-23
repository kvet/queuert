# Guides

The runnable code behind the [guides](https://kvet.github.io/queuert/guides/). Each file in `src/` belongs to one docs page, which embeds its regions, and keeps its state in the in-process state adapter, so it runs with no database.

- `src/batched-processors.ts` — [Batched Processors](https://kvet.github.io/queuert/guides/batched-processors/)
- `src/chain-awaiting.ts` — [Chain Awaiting](https://kvet.github.io/queuert/guides/chain-awaiting/)
- `src/chain-deletion.ts` — [Chain Deletion](https://kvet.github.io/queuert/guides/chain-deletion/)
- `src/chain-patterns.ts` — [Chain Patterns](https://kvet.github.io/queuert/guides/chain-patterns/)
- `src/cleanup.ts` — [Cleanup](https://kvet.github.io/queuert/guides/cleanup/)
- `src/deduplication.ts` — [Deduplication](https://kvet.github.io/queuert/guides/deduplication/)
- `src/error-handling.ts` — [Error Handling](https://kvet.github.io/queuert/guides/error-handling/)
- `src/error-recovery.ts` — [Processing Reliability](https://kvet.github.io/queuert/how-it-works/processing-reliability/)
- `src/job-blockers.ts` — [Job Blockers](https://kvet.github.io/queuert/guides/job-blockers/)
- `src/middleware.ts` — [Middleware](https://kvet.github.io/queuert/guides/middleware/)
- `src/prioritization.ts` — [Prioritization](https://kvet.github.io/queuert/guides/prioritization/)
- `src/queries.ts` — [Queries](https://kvet.github.io/queuert/guides/queries/)
- `src/scheduling.ts` — [Scheduling](https://kvet.github.io/queuert/guides/scheduling/)
- `src/signals.ts` — [Job Processing](https://kvet.github.io/queuert/how-it-works/job-processing/)
- `src/timeouts.ts` — [Timeouts](https://kvet.github.io/queuert/guides/timeouts/)
- `src/workerless-outcomes.ts` — [Workerless Outcomes](https://kvet.github.io/queuert/guides/workerless-outcomes/)

The [Feature Slices](https://kvet.github.io/queuert/guides/slices/) guide spans several files, so it has its own package, [`guides-slices`](../guides-slices). [Application Migrations](https://kvet.github.io/queuert/guides/application-migrations/) runs in the state examples, such as [`postgresql/state-postgres-js`](../postgresql/state-postgres-js).

## Running

```bash
pnpm install
pnpm --filter example-guides start
node examples/guides/src/job-blockers.ts
```
