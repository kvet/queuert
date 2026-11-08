# Sync factories

Make every public factory that does no I/O at construction synchronous, and rewrite the "Async factory functions" rule in `code-style.md` to match. Investigation result: that is all eleven `async` factories.

## Problem

`code-style.md` says factories that perform I/O are async and pure configuration factories are sync, and makes one stated exception: `createOtelObservabilityAdapter` is async "for future-proofing". In practice eleven public factories are `async`, and none of them awaits anything in its setup body. Every `await` sits inside the methods they return.

| Factory                                                                                     | What construction actually does                                                                                       |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `createClient` ([client.ts](../packages/core/src/client.ts))                                | Builds helpers, returns the client object                                                                             |
| `createInProcessWorker` ([in-process-worker.ts](../packages/core/src/in-process-worker.ts)) | Validates config and `workerId`, merges processors, returns `{ start }`; registration and polling happen in `start()` |
| `createInProcessStateAdapter`                                                               | Creates maps and a read/write lock                                                                                    |
| `createInProcessNotifyAdapter`                                                              | Creates listener maps and a latch                                                                                     |
| `createOtelObservabilityAdapter`                                                            | Creates OTEL instruments, which is synchronous                                                                        |
| `createPgStateAdapter` / `createSqliteStateAdapter`                                         | Validates SQL identifiers, prepares typed SQL; the schema is applied later by `migrateToLatest()`                     |
| `createPgNotifyAdapter` / `createRedisNotifyAdapter` / `createNatsNotifyAdapter`            | Builds channel/subject names and lazy `createSharedListener`s; the first `listen*` call subscribes                    |
| `createDashboard` ([dashboard.ts](../packages/dashboard/src/api/dashboard.ts))              | Returns `{ fetch }`; static assets load lazily on the first asset request                                             |

The `Promise` return type tells users setup may touch the database or network when it never does. It forces `await` at every construction site and rules out building a client or adapter at module top level in a CommonJS or non-async context.

## Design

### Public API

Drop `async` from all eleven factories and change the return types from `Promise<X>` to `X`. Arguments, returned objects and behavior are otherwise unchanged.

Construction-time validation errors are now thrown synchronously instead of rejecting. That affects:

- `createInProcessWorker`: `TypeError` for invalid options, `InvalidWorkerIdError`, `DuplicateJobTypeError`, the missing-`requiredAttemptMiddleware` error.
- `createPgStateAdapter` / `createSqliteStateAdapter`: invalid `schema`, `tablePrefix`, `jobIdType` or `workerIdType`.

TSDoc `@throws` lines stay as they are; they already describe throws.

### Compatibility for users

Most user code keeps working, because `await` on a non-Promise returns the value and `try { await createX() } catch` still catches a synchronous throw. Code that breaks:

- `createX(...).then(...)` / `.catch(...)`.
- Explicit annotations such as `const p: Promise<Client> = createClient(...)` or functions declared to return `Promise<StateAdapter>` from a factory call without `async`.
- Users with typescript-eslint `await-thenable` get a lint warning on each leftover `await`.

`Awaited<ReturnType<typeof createX>>` keeps compiling (`Awaited` of a non-Promise is the type itself); it can be simplified to `ReturnType<typeof createX>`.

This is still a signature change, so it ships as `major`.

### Repository changes

About 1,070 `await createX(...)` sites across roughly 200 files: core and adapter specs, every example, the benchmarks, docs content (`docs/src/content`), TSDoc `@example`s and design docs. `createClient` (512) and `createInProcessWorker` (306) dominate.

- Drop the `await` at each site. The repo lints with `typescript/await-thenable` (`.oxlintrc.json`, `warn`) under `--type-aware`, so lint flags every leftover in TS sources; markdown/MDX snippets need a manual pass.
- Rejection assertions become throw assertions: `await expect(createX(...)).rejects.toThrow(E)` → `expect(() => createX(...)).toThrow(E)`. Affected specs: `in-process-worker.config-validation.spec.ts` (1), `in-process-worker.merge.spec.ts` (2), `in-process-worker.required-attempt-middleware.spec.ts` (5), `pick-job-type-processors.spec.ts` (2), postgres and sqlite `state-adapter-options-validation.spec.ts` (5 and 4). Use block-bodied callbacks — `pnpm fmt`'s oxlint fix is known to rewrite sync/async-ambiguous callbacks.
- `Awaited<ReturnType<typeof …>>` in `benchmarks/type-complexity`, `packages/dashboard/src/specs/api.spec.ts` and the postgres/sqlite `state-adapter-migration.spec.ts` simplify to `ReturnType<…>`.
- `benchmarks/memory-footprint` wraps each construction in `step(label, async () => createX())`; those keep working but can drop the `async` wrapper.

### `code-style.md`

Replace the "Async factory functions" rule with "Sync factory functions": factories are synchronous and do no I/O. I/O goes in the methods they return (`start()`, `listen*`, `migrateToLatest()`) or runs lazily on first use. Remove the `createOtelObservabilityAdapter` future-proofing note.

### Future I/O at setup

Factories stay sync even when an adapter later needs startup I/O. Such work goes behind an explicit method or runs lazily on first use, as `migrateToLatest()` and dashboard asset loading do today. For example, a schema-version check in the PG/SQLite adapters would be an explicit `checkSchema()` call or a check on the first query, never an `async` factory.

## Open questions

- **Relation to the generator-based core.** Both remove `await`s that do no work, but this change is one-time at startup and has no throughput effect; the per-job `await` hops are the generator-core item. The two are independent and can land in either order.
- **`await-thenable` autofix.** Not yet verified whether oxlint's `--fix` removes the redundant `await`s automatically; if it does, most TS sites are mechanical.

## Changeset

One `major` changeset bumping `queuert`, `@queuert/postgres`, `@queuert/sqlite`, `@queuert/redis`, `@queuert/nats`, `@queuert/otel` and `@queuert/dashboard`: the listed factories now return their value synchronously, and construction-time validation errors throw instead of rejecting.
