# Worker runner

Rename `createInProcessWorker` → `createWorkerRunner` and `InProcessWorker` → `WorkerRunner`, and give the object the word **worker runner** in the Domain Vocabulary. `Worker` keeps meaning one row in the `worker` table.

## Problem

Two concepts share the word "worker":

- **The row.** `Worker<TWorkerId>` ([entities/worker.types.ts](../packages/core/src/entities/worker.types.ts)) is one row in the `worker` table: an id, its job types, its concurrency and a lease. `client.getWorker`, `getWorkers`, `listWorkers`, `countWorkers`, `workerId`, the `worker*` events, `WorkerLeaseLostError` and `WorkerAlreadyLiveError` all mean the row.
- **The object that runs it.** `createInProcessWorker` returns an object that registers one worker at a time under a stable `workerId`, renews its lease, claims jobs and runs attempts across `concurrency` slots, and after a lost lease or a failed registration registers again under the same id. Over its life it registers many rows. Each registration is one run.

`code-style.md` gets around this with a qualifier: "In-process worker: what `createInProcessWorker` returns". "In-process" says where the object runs, not what it is. Users shorten it to "worker" (every example writes `const worker = await createInProcessWorker(...)`), which brings the two concepts back together. It also clashes with `createInProcessStateAdapter` / `createInProcessNotifyAdapter`, where "in-process" means "in-memory, no database".

The obvious rename, `createWorker` → `Worker`, takes the name of the public row type. `getWorker` returning a row named `Worker` is the natural reading and stays.

## Design

The split follows **attempt** (stored) → **attempt handler** (what executes it): **worker** (stored row) → **worker runner** (what runs it).

### Domain Vocabulary

In `code-style.md`, replace the "In-process worker" entry:

- **`worker`**: unchanged. One row in the `worker` table.
- **worker runner**: what `createWorkerRunner` returns. It runs one worker at a time and registers it again under the same `workerId` after a lost lease. Each registration is a run.

"Runner" on its own is not used for this concept. The `queuert/conformance` runner and "test runner" in the integrations docs keep their meaning, so prose always says "worker runner".

### Public API (`queuert`)

| Before                  | After                |
| ----------------------- | -------------------- |
| `createInProcessWorker` | `createWorkerRunner` |
| `InProcessWorker`       | `WorkerRunner`       |

- This is a hard rename with no deprecated aliases, consistent with the tx hooks rename.
- Options, `start()`, the returned `stop`, events, errors and behavior are unchanged.
- Error messages use the new name: `createWorkerRunner: invalid configuration:`, `createWorkerRunner: one or more processors are missing requiredAttemptMiddleware …`, and "the worker runner is already started; await the stop function returned by start() before starting it again".
- These stay: `Worker`, all client worker queries, `workerId`, `WorkerLeaseConfig`, `generateWorkerId` / `validateWorkerId`, `InvalidWorkerIdError`, `WorkerLeaseLostError`, `WorkerAlreadyLiveError`, `createInProcessStateAdapter` and `createInProcessNotifyAdapter`.

### Internal names

- `InProcessWorkerProcessor` (not exported) → `Processor`, the singular of the exported `Processors`.
- `packages/core/src/in-process-worker.ts` → `packages/core/src/worker-runner.ts`, and `in-process-worker.*.spec.ts` → `worker-runner.*.spec.ts`.
- `worker/run-worker.ts` / `runWorker` keep their names: under the new vocabulary they run one worker, which is accurate.
- TSDoc that says "in-process worker" for the object becomes "worker runner". That covers `worker.types.ts`, `worker-lease.ts`, the `@internal` note in `client.ts`, `job-type-processors.ts`, `create-job-type-processors.ts`, `merge-job-type-processors.ts`, and the `generateWorkerId` / `validateWorkerId` docs of the in-process, PostgreSQL and SQLite state adapters.

### User code

Examples, docs snippets, benchmarks and tests name the variable after the concept:

```ts
const workerRunner = await createWorkerRunner({ client, processors });
const stopWorkerRunner = await workerRunner.start();
```

Variables that qualify the object keep their qualifier: `urgentWorker` → `urgentWorkerRunner`, `workerRunner1` / `stopWorkerRunner1`. Bare `stop` stays where it is used today.

### Docs site

- `how-it-works/in-process-worker.mdx` → `how-it-works/worker-runner.mdx`, titled "Worker Runner". Update its entry in `docs/src/docs/sections.ts` and the guide link in `docs/src/data/examples.ts`.
- Update links in `getting-started/core-concepts.md`, `guides/horizontal-scaling.mdx`, `guides/timeouts.md` and `how-it-works/job-processing.mdx`.
- The site has no redirect mechanism, so the old URL stops working. This is accepted before 1.0.
- Prose that means the object says "worker runner". Uses of "in-process" that describe where code runs (the Inngest comparison's "plain in-process workers", the in-process state and notify adapters) are rewritten only where they name the object. Content stays the same: this is a re-wording, not new material.
- On the identity paragraph: "Two in-process workers configured with the same id never run at the same time" becomes "Two worker runners configured with the same id never hold the worker at the same time", so runners don't "run" in two senses.
- The API reference (`docs/src/routes/api/index.tsx`), the `AdapterLayers` chip row and the integrations pages list `createWorkerRunner`.

### Other references

- `code-style.md`: the Core Package Exports table and the factory-options convention name `createWorkerRunner` / `WorkerRunner`.
- `TODO.md`: the "Revise factories" item names `createWorkerRunner`.
- `.claude/agents/publish-review/accepted.md`: both accepted entries name `createWorkerRunner`.
- The pending changeset `drop-tokenless-sweep.md` says "Worker runners" instead of "In-process workers".
- `CHANGELOG.md` files are history and are not edited.
- `design/batched-processors.md` says "worker runners".

## Changeset

One `major` changeset for `queuert`, covering the renamed factory and type and the moved docs page. The other packages change only TSDoc and tests, so they need no bump.

## Tests

The rename is covered by the existing suites, which move to the new names. `worker-runner.config-validation.spec.ts` and `worker-runner.required-attempt-middleware.spec.ts` assert the new `createWorkerRunner:` message prefix. `pnpm check` (typecheck over examples, benchmarks and docs) catches any leftover reference.

## Out of scope

- Making `createWorkerRunner` synchronous. That belongs to the "Revise factories" TODO item. If both ship in the same release, users update each call site once.
