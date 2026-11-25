# Feature slices guide

The runnable code behind the [Feature Slices](https://kvet.github.io/queuert/guides/slices/) guide. Each feature slice owns a definitions file and a processors file, and `src/client.ts` and `src/index.ts` merge the slices into one client and one worker. State lives in the in-process state adapter, so it runs with no database.

- `src/slice-notifications-definitions.ts`, `src/slice-notifications-processors.ts` — a self-contained slice
- `src/slice-orders-definitions.ts`, `src/slice-orders-processors.ts` — a slice whose job is blocked by a job type of the notifications slice
- `src/client.ts`, `src/index.ts` — the slices composed into one client and one worker

## Running

```bash
pnpm install
pnpm --filter example-guides-slices start
```
