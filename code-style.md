# Code Style

## Overview

This document describes code style conventions, testing patterns, and project organization for Queuert development.

## General Principles

- **Inline types used in only one place**: Don't create separate type definitions for types used once. This applies to function parameters, return types, and generic type arguments — embed them directly in the function signature instead of extracting a named type alias
- **Comments are TSDoc on public API only**: Document exported public symbols with TSDoc, since it generates the API reference. Internal code carries no comments — no inline `//` comments and no TSDoc on internal functions or types. Make the code say it instead, through names, structure, and tests. The only inline comments allowed are lint suppressions (see below)
- **Describe the current behavior only**: Docs, TSDoc, comments, examples, and test names describe what the code does now, as if it had always worked this way. Don't explain a change by contrast with what came before — no "no longer", "now", "instead of", "the signal carries no reason", or a removed name mentioned only to say it is gone. A reader who never saw the old version can't use that, and it goes stale with the next change. When a change removes something, delete the prose about it rather than rewriting it into a disclaimer. The only place for before/after framing is the changeset.
- **Multiline doc comments for long or multi-clause descriptions**: Keep single-line `/** ... */` doc comments only for short descriptions that comfortably fit the line width (~100 chars). Once a doc comment runs longer than one line, or enumerates multiple clauses (several `@throws`, `@param`, or a trailing `@defaultValue`/`@internal`), expand it to a multiline block and put each tag on its own line — a crammed one-liner listing every error a method throws is unreadable in both source and editor tooltips. Prefer prose `@throws {@link SomeError} if …` lines over a comma-separated "Throws X, Y, Z" sentence.
- **Merge similar functionality**: Look for patterns and consolidate before adding new code
- **Search before implementing**: Check for similar existing implementations before adding new features
- **Reuse `@queuert/helpers`**: Small runtime utilities shared across packages live in `packages-internal/helpers` (`sleep`, `raceWithSleep`, `createLatch`, `createCallOnce`, `createSharedListener`, `serializeError`, …), with test utilities in `@queuert/helpers/testing`. Import each one from its own file (`@queuert/helpers/sleep`), since the package has no barrel, instead of re-declaring a local copy, in source and in specs alike. When a utility is needed by a second package, move it into `@queuert/helpers` rather than duplicating it.
- **Typed error classes**: Use specific error types for all thrown errors (`JobNotFoundError`, `JobAlreadyCompletedError`, etc.) to enable proper error handling by consumers. Generic `Error` should only be used for truly unreachable code paths (assertion-style guards). If a caller could reasonably need to catch and handle an error, it must have a specific type. Throws that are not recoverable — programmer-error invariants, corrupted internal input (e.g., malformed cursors), and configuration mistakes that surface at setup time and require a code change to fix — stay as bare `Error`; a typed class adds API surface without enabling any new caller behavior. The same goes for caller misuse the type system already rejects: the runtime throw is a backstop for JavaScript callers and for `any` erasing the signature, so it needs a clear message, not a class nobody can meaningfully catch. `requireTxCtx` in `packages/core/src/state-adapter/tx-context.ts` is the reference case — the transaction context is required by the method's type, and the throw only fires when the types were bypassed.
- **Factory functions over classes**: Expose `createClient()` instead of `new Client()`. Classes can be used internally, but the public API should always be factory functions. This keeps constructors private and makes the API consistent.
- **Nullable conventions**: Use `undefined` for "not found/not present" and `null` for "explicitly set to no value". For example, `getJobById` returns `undefined` when job doesn't exist, while `job.completedAt` is `null` before completion.
- **List methods are paginated, get methods are capped**: A `list*` method on the state adapter or the client takes a cursor and a limit (`PageParams` on the adapter, `cursor` / `limit` options on the client) and returns a `Page`, ordered by a unique key so the cursor stays stable. Only a `get*` method returns a plain array, and only when its length is bounded: by its input (`getJobs` returns one entry per requested id), by a configured limit (`getJobBlockers` returns at most `maxBlockersPerJob` chains), or by the type names an app writes (`getJobTypeNames`, `getChainTypeNames`). A collection the data alone sizes is a `list*` method and is paginated. A screen that needs a total or a sum over such a collection gets it from a `count*` method, never by fetching every page.
- **Prefer explicit context passing over async context**: Use parameters, callbacks, and handles to pass context rather than relying on `AsyncLocalStorage` or `async_hooks`. The library does not bind or snapshot async context internally — callers (e.g., OTEL adapters) are responsible for propagating their own async context.
- **No hard-wrapped prose in markdown**: Keep each paragraph on a single continuous line in `.md` files — don't split sentences across multiple lines for line-length reasons. Let the editor soft-wrap instead.
- **No abbreviated names**: Use full words in variable names, type names, and type parameters. Write `TDefinitions` not `TDefs`, `definitions` not `defs`, `config` not `cfg`. Single-letter type parameters (`T`, `K`) are fine when there's only one and the meaning is obvious. `ctx`/`TCtx` is also acceptable as a well-established abbreviation.
- **No underscore prefix on type names or type parameters**: Don't mark file-local helper types or "internal" type parameters with a leading `_` (e.g., `_ChainWalk`, `_TComplete`). All types in TypeScript are file-local unless exported, so the underscore conveys nothing — just give them descriptive names. For unused `infer` positions in conditional types, use `any` instead of `infer _TFoo`.
- **Consistent pluralization**: Keep singular/plural consistent across related names — including functions, types, type parameters, variables, and file names. If a function is `defineJobTypes` (plural), related type parameters and variables should also use plural — e.g., `TJobTypeDefinitions` not `TJobTypeDefinition`, `jobTypes` not `jobType` (when referring to the collection).
- **Arrow functions over function declarations**: Use `export const fn = () => {}` instead of `export function fn() {}`. This applies to all exports — named functions, factories, helpers, etc. The one exception is a function with overloads, such as a factory whose result follows a `mode` option or the provider's mode: declare it with `function` overload signatures, so the compiler checks the implementation against each overload, never as a `const` typed with the overloads and an `as any` implementation.
- **Sync factory functions**: Factory functions are synchronous and do no I/O. Startup I/O goes in an explicit method the factory returns (`start()`, `migrateToLatest()`), so a caller can see it fail. Only I/O whose failure is not fatal may run lazily on first use, and its failure is reported through the observability adapter rather than swallowed. When an adapter needs startup work, such as checking its schema, it gets an explicit method, never an `async` factory.
- **No barrel files**: Do not create barrel re-export files within subdirectories. The only barrels are a package's declared entry points — the files listed in its `package.json` `exports`, one per subpath: `index.ts` for the package root, plus subpath entries like `internal.ts` (cross-package internals with no stability guarantee), `conformance.ts`, and `conformance-internal.ts` (the Node-only conformance groups, `toConformanceTestCases` and the helpers the adapter packages and our specs compose, such as the in-process adapters and the state seeders, kept out of the browser-safe `internal.ts`). Packages publish no testing entry point; vitest-only helpers live in the private `@queuert/helpers` package (`@queuert/helpers/conformance` for `conformanceTestSuite`, `@queuert/helpers/testing` for other test helpers such as leak detection). Adding a barrel means adding an `exports` subpath; a re-export file that is not an entry point is the thing to avoid. Internal modules import directly from the source file they need.
- **No type re-exports from non-owning modules**: A module should only export types it defines. Do not import a type from its source module just to re-export it — consumers should import directly from the module that owns the type. The only exception is each package's top-level `index.ts` entry point.
- **Justify every lint suppression**: An `oxlint-disable*` comment always carries the rule name and a `--` reason explaining why the rule is wrong here, e.g. `// oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error`. A bare disable is not acceptable; if the reason is long, point at the file or spec that demonstrates it.
- **TypeScript runs on Node's type stripping**: Examples, benchmarks, and spawned scripts run as `node file.ts` with no loader, so source must be erasable TypeScript (no enums, namespaces, or constructor parameter properties; `erasableSyntaxOnly` enforces this). Relative imports name the real file with its `.ts` extension (`./client.ts`, not `./client.js`). Import types with `import type { A, B }` when every specifier is a type and with inline `type` when mixed with values (`import { createClient, type Client }`); `verbatimModuleSyntax` and `typescript/no-import-type-side-effects` enforce this. Child processes are spawned with `process.execPath`, not `"node"`, so they inherit the running Node.
- **Minimum server versions**: Each state adapter supports a minimum server version (PostgreSQL 14, SQLite 3.42, MySQL 8.4, MariaDB 11.4, Redis 6), names it in the TSDoc of its create function and in the docs "Requires" line, and does not check it at runtime: the specs running on that minimum are what guarantee it. Package specs run on that minimum (`postgres:14`, `redis:6`, `mysql:8.4`, `mariadb:11.4`, `nats:2.2`), so every supported version is tested. Examples and benchmarks run on the latest major tag (`postgres:18`, `redis:8`, `mysql:26`, `mariadb:13`, `nats:2`). `benchmarkServers` in `docs/src/data/benchmarks.ts` names the versions the published numbers in `benchmarks/*/results.md` come from, so it changes with the benchmark images. Raising a minimum updates the TSDoc, the docs "Requires" lines (including the installation picker in `docs/src/data/installation.tsx`) and the spec images together.
- **Symbol descriptions prefixed with `queuert.`**: All internal `Symbol()` instances must use a `"queuert."` prefix in their description string, e.g. `Symbol("queuert.helpers")`. This makes symbols identifiable in debugging and avoids collisions.
- **One body for both modes**: Code that runs over adapters of either mode is written once, and everything sync/async comes from the single `@queuert/sync-async` entry. A body that awaits is a `syncAsync(function* …)`, everywhere it can be, core's runtime included: `yield* step(x)` stands where `await x` would, `yield* other.steps(...)` calls another sync-async function, and the caller picks the variant with `.sync(...)` or `.async(...)` (in core, `runInMode` and `withHelpersTransaction` pick it from the client's mode). The `@queuert/sync-async/plugin` build plugin (`syncAsyncCompiler`) compiles each body into a plain sync and a plain async function in every package build and vitest config that has sync-async bodies (`queuert`, `@queuert/sqlite`, and the packages that bundle `packages-internal/typed-sql`), leaving tests and conformance cases as generators (`exclude: /[\\/]conformance[^\\/]*[\\/]|conformance[^\\/]*$|\.spec(-helper)?\.ts$/`); `.steps` is only callable from inside another sync-async body, and a compiled body cannot `wait` or create a `resource`. Benchmarks load the built `dist` output, so they measure compiled bodies. Tests, conformance cases and other code that is not performance-critical and cannot be a compiled `syncAsync` use `dynamicSyncAsync(function* …)`. Code whose mode is known before it runs, from an adapter's or provider's `sync` flag or a `mode` argument, is a `syncAsync` body too, even when it wraps another function: the logging wrappers, the notify helper, `reportErrors`, `createCallOnce` and the spy conformance adapters pick `.sync` or `.async` from that mode, and a helper that has no mode of its own takes one (`{ sync }` or `mode`). The value-following helpers (`andThen`, `tryCatch`, `tryFinally`) are only for code whose mode is known from nothing but the value a user's callback returns: `withTxHooks` and the tx hooks' `withSavepoint` and `retryBoundary`, and `createSqliteStateProviderConformanceContext`, whose mode comes from the provider the user's factory returns. `all` runs values concurrently, which a sequence of steps cannot express, and `requireSync` and `isThenable` check a callback's result.
- **Synchronous callbacks return `void`**: A callback whose result is ignored and that must not be async (`txHooks.onRollback` callbacks) is typed `() => void`, and its TSDoc says it runs synchronously and a returned promise is not awaited. `typescript/no-misused-promises` flags an async function passed there. Don't type it `() => undefined` to reject async functions: it also rejects callbacks that return a value by accident and standalone helpers inferred as `() => void`.

## Naming Conventions

### Avoid Redundant Package Prefixes

Public exports should not include the package name as a prefix. Since imports already provide namespace context, repeating it is redundant:

```typescript
// Good - context from import is sufficient
import { createClient, createWorkerRunner, type Client } from "queuert";
// Bad - redundant prefix
import { createQueuertClient, createQueuertWorkerRunner, type QueuertClient } from "queuert";
```

### Use `chain`, not `jobChain`

In variable names, type names, method names, and documentation, use `chain` (not `jobChain`). The library's only nouns are `Job` and `Chain`; the qualifier `Job` adds no information. This applies to the entire public surface — `Chain`, `getChain`, `createChain`, `client.listChainJobs`, etc. Internal references on entities (`Job.chainId`, `StateAdapter.chainId`) follow the same rule.

```typescript
// Good
const chain = await client.getChain({ id });
const chains = await client.listChains({ filter });

// Bad - over-qualified
const jobChain = await client.getJobChain({ id });
const jobChains = await client.listJobChains({ filter });
```

### Domain Vocabulary

Once a concept has a word, that word is the only one for it — everywhere, including column names, status values, exported symbols, option fields, error classes, event names, variable names, comments, docs, error messages, and design documents. A design document that reaches for a synonym in prose does not license one in code. When a concept has no established word yet, pick one, use it consistently, and add it here.

- **Job and chain state**: a job is `blocked`, `pending`, `running`, or `completed`; a chain is `running` or `completed`. These are persisted in the schema and exposed on the public API. No `open`/`closed`, `active`/`done`, `queued`/`finished`.
- **`head` and `tail`**: a chain's ends are its `head` and `tail` job, never "first"/"last" or "root"/"leaf".
- **`attempt`**: a job has `attempt`s, not "tries" or "runs"; "try" is reserved for transaction callbacks (below).
- **`try`**: one run of a transaction callback that a driver or loop may rerun; `txHooks.retryBoundary` separates tries. It is never called an "attempt", which is a job's.
- **`reschedule`**: a job is `reschedule`d, not "requeued" or "retried".
- **consecutive failures**: `consecutiveFailures` / `consecutive_failures`, the attempts in a row that failed or were reclaimed; never a "streak" or "retry count".
- **attempt error**: `lastAttemptError` / `last_attempt_error`, the serialized error of the last attempt when it failed or was reclaimed; never a "failure reason".
- **reschedule reason**: `lastRescheduleReason` / `last_reschedule_reason`, the `reason` a handler or client gave for the last reschedule; never a "note" or "message".
- **`continueWith`**: a chain `continueWith`s, not "chains to" or "forwards".
- **`entry`**: an `entry` job type is one that can start a chain; don't reuse "entry" for list items or other inputs.
- **`input`**: a job's payload; don't use it as a suffix for "what a caller passes" when the type also carries an `input` field.
- **`worker`**: one row in the `worker` table — an id, its job types, its concurrency and a lease. Its id is the `workerId` in `attemptBy`, `completedBy` and worker events. A worker starts and stops.
- **worker runner**: what `createWorkerRunner` returns. It runs one worker at a time and registers it again under the same `workerId` after a lost lease. Each time it registers the worker is a **registration**, identified by the row's `token`; a registration is never called a "run". It is always "worker runner", never "runner" alone, which keeps its meaning for the `queuert/conformance` runner and test runners.
- **`lease`**: a worker's `lease_until`, live while it is in the future in database time; a worker whose lease is gone has lost it.

### State Adapter Identifiers

The SQL state adapters (`state-adapter.pg.ts`, `state-adapter.sqlite.ts`, `state-adapter.mysql.ts`) share one naming scheme for what they read from the database:

- Column-type objects are `db<Entity>Columns` (`dbJobColumns`, `dbChainColumns`, `dbChainRowColumns`, `dbWorkerColumns`), and the row types inferred from them `Db<Entity>` (`DbJob`, `DbChainRow`, `DbWorker`).
- Row mappers are `mapDb<Source>To<Target>` (`mapDbJobToStateJobInfo`, `mapDbChainRowToStateChain`, `mapDbWorkerToStateWorkerInfo`).
- Upper-case constants that list columns take a `DB_` prefix (`DB_JOB_COLUMNS`).
- A refactor keeps every existing identifier; only new ones need names, and they follow this scheme.

### Type Naming Scheme

- **`New<Entity>` for something a caller asks to create**: `NewJob` (`typeName`, `id?`, `input`, `schedule?`, `blockers`) is the job passed to `continueWith`; `NewChain` adds `deduplication?` and is what `createChain` and the `createChains` items accept. Method option types build on these (`NewChain & tx context`) instead of restating their fields.
- **`Any<Name>` only for the type-erased counterpart of a generic public type**, used by internal code that handles every job type and so cannot be generic over the definitions (`AnyJob`, `AnyChain`, `AnyNewJob`, `AnyAttemptMiddleware`). Define it next to the generic type it mirrors, never inside the implementation file that consumes it. A union over all type names is not erased — express it with the generic type and its default type parameter (`NewChain<TJobId, TJobTypeDefinitions>`), not a separate `Any…` name.
- **Mode is a type parameter, never a `Sync` prefix**: a type that differs only by mode takes `TMode`, required on `StateAdapter` and `NotifyAdapter` and `"async"` by default elsewhere (`StateAdapter<…, "sync">`, `SqliteStateProvider<TTxContext, "sync">`, `Migrator<"sync">`). Members return `ModeResult<TMode, …>`, and adapters add `AdapterLifecycle<TMode>` (`sync: true`, `close`, the dispose symbol). "Either mode" is written `X<…, Mode>`, never as a `Mode`-prefixed alias. An async adapter or provider leaves `sync` unset or `false`, so code checks `x.sync === true` inline. A factory that builds either mode takes a `mode` option with overloads (`createInProcessStateAdapter`, `createInProcessNotifyAdapter`, `createBetterSqlite3Provider`; the in-process ones default to `"sync"`). The client, processors, worker runner, tx hooks and the factories that take a provider (`createSqliteStateAdapter`, `createSqliteMigrator`) follow the adapter's mode. A name with only a synchronous form takes no prefix.
- **Define a shape once.** When the same fields appear in a client method, a handler outcome and the implementation, extract the generic type plus its `Any…` counterpart rather than keeping parallel copies.

Names on persisted state and the public API are the expensive ones: a column or a status value survives a migration, so pick the established word before it ships rather than renaming after.

### Concise Error Names

Error class names should be descriptive but not excessively long. Prefer shorter names that still clearly convey the error:

```typescript
// Good
WaitChainTimeoutError;

// Bad - unnecessarily verbose
WaitForJobChainCompletionTimeoutError;
```

### Error Class Shape

Every error class follows the same shape, so callers can rely on it:

- Extends `Error`, with a TSDoc summary starting "Thrown when …".
- Carries its context as `readonly` fields, each with its own TSDoc line — never stuffed into the message alone.
- Takes `(message: string, options: { …context; cause?: unknown })`. Context is required in `options`; `cause` is optional.
- Passes `cause` through conditionally and sets `name` explicitly, since subclass names do not survive transpilation:

```typescript
export class JobNotFoundError extends Error {
  /** The ID that was looked up. */
  readonly jobId: string;

  constructor(message: string, options: { jobId: string; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobNotFoundError";
    this.jobId = options.jobId;
  }
}
```

Batch operations get a plural sibling that reports **every** offending input rather than failing on the first — `JobsNotFoundError` alongside `JobNotFoundError`, carrying `jobIds` instead of `jobId`. Where a singular method delegates to the plural one, it catches the batch error and rethrows the singular form with the batch error as `cause`.

### Core Package Exports

The core `queuert` package exports these primary factory functions and types:

| Export               | Description                                                                        |
| -------------------- | ---------------------------------------------------------------------------------- |
| `createClient`       | Creates a client for starting and managing job chains, in its state adapter's mode |
| `Client`             | Type for the client instance                                                       |
| `createWorkerRunner` | Creates a worker runner for processing jobs                                        |
| `WorkerRunner`       | Type for the worker runner instance                                                |
| `StateAdapter`       | Type for a state adapter; required mode: `"async"`, or `"sync"` with `sync: true`  |

### Adapter Package Exports

Adapter packages use their domain-specific prefixes (not "Queuert"):

| Package              | Factory Function                 | Type                        |
| -------------------- | -------------------------------- | --------------------------- |
| `@queuert/postgres`  | `createPgStateAdapter`           | `PgStateAdapter`            |
| `@queuert/postgres`  | `createPgNotifyAdapter`          | -                           |
| `@queuert/postgres`  | -                                | `PgStateProvider`           |
| `@queuert/postgres`  | -                                | `PgErrorClassification`     |
| `@queuert/postgres`  | -                                | `PgNotifyProvider`          |
| `@queuert/postgres`  | -                                | `MigrationResult`           |
| `@queuert/postgres`  | `createPgMigrator`               | `Migrator`                  |
| `@queuert/postgres`  | -                                | `Migration`                 |
| `@queuert/postgres`  | -                                | `MigrationScript`           |
| `@queuert/sqlite`    | `createSqliteStateAdapter`       | `SqliteStateAdapter`        |
| `@queuert/sqlite`    | -                                | `SqliteStateProvider`       |
| `@queuert/sqlite`    | -                                | `SqliteErrorClassification` |
| `@queuert/sqlite`    | `createAsyncRwLock`              | `AsyncRwLock`               |
| `@queuert/sqlite`    | -                                | `LockHandle`                |
| `@queuert/sqlite`    | -                                | `MigrationResult`           |
| `@queuert/sqlite`    | `createSqliteMigrator`           | `Migrator`                  |
| `@queuert/sqlite`    | -                                | `Migration`                 |
| `@queuert/sqlite`    | -                                | `MigrationScript`           |
| `@queuert/redis`     | `createRedisStateAdapter`        | `RedisStateAdapter`         |
| `@queuert/redis`     | -                                | `RedisStateProvider`        |
| `@queuert/redis`     | -                                | `RedisContext`              |
| `@queuert/redis`     | -                                | `RedisTransaction`          |
| `@queuert/redis`     | `RedisTransactionConflictError`  | -                           |
| `@queuert/redis`     | -                                | `MigrationResult`           |
| `@queuert/redis`     | `createRedisNotifyAdapter`       | `RedisNotifyProvider`       |
| `@queuert/nats`      | `createNatsNotifyAdapter`        | -                           |
| `@queuert/ipc`       | `createIpcNotifyAdapter`         | -                           |
| `@queuert/otel`      | `createOtelObservabilityAdapter` | -                           |
| `@queuert/dashboard` | `createDashboard`                | -                           |

## Reference Documentation

Architecture and API-contract prose lives in `docs/src/content/docs/how-it-works/` (core); the `docs/src/content/docs/integrations/` pages are user-facing setup and configuration (plus the schema and the OpenTelemetry metric/span catalogue). The per-symbol **API reference** for every public package is generated from source TSDoc by TypeDoc at docs-site build time (configured in `docs/plugins/typedoc.ts`, packages listed in `apiPackages` in `docs/src/docs/sections.ts`) — there are no hand-written reference pages, so the TSDoc comment on each exported symbol is the source of truth for its documentation. Keep those comments accurate and complete.

### Documenting options-object parameters

Factory functions that take a single destructured options object (`createClient`, `createWorkerRunner`, the adapter factories, etc.) follow one convention so TypeDoc renders them consistently:

- Add a single bare `@param options - <summary>` tag to the function's doc comment. This is **required**: without it TypeDoc labels the parameter `__namedParameters` and silently drops any per-field descriptions.
- Document each field with an inline TSDoc comment on the type-literal member (colocated with the type), including `@defaultValue` where relevant.
- Do **not** use dotted `@param options.<field>` tags — field docs belong on the type members, not in the function comment.

```ts
/**
 * Create a new Queuert client.
 *
 * @param options - Client configuration.
 */
export const createClient = ({
  stateAdapter,
  log,
}: {
  /** Database adapter for job persistence. */
  stateAdapter: TStateAdapter;
  /** Optional structured log function. @defaultValue no-op */
  log?: Log;
}): Client => {
  // ...
};
```

## Testing Patterns

### General Guidelines

- Embed small verification tests into existing related tests rather than creating separate ones
- Test the relevant outcomes of an attempt: work before the transaction, `complete` committed, `complete` rolled back, and errors before and after the commit
- Prefer descriptive test names that match what's being tested
- To enable verbose logging when debugging tests, run with `DEBUG=1` environment variable
- **No one-line helpers in tests or conformance cases**: assert fields where they are checked (`assert.equal(job.status, "running"); assert.equal(job.attemptBy, worker.id)`) and call utilities such as `raceWithSleep` at the assertion site. A curried predicate or a wrapper around a single assertion or utility call hides what the case checks.
- **Fixtures**: Define vitest fixtures with the builder form, `it.extend("name", { scope }, async (context, { onCleanup }) => value)`, and let their types be inferred; inline a type that only one fixture uses. A spec builds its own chain from vitest's `it`; there are no `extendWith*` wrappers that take an `it` and return another. Fixtures several specs share are exported as fixture functions and passed to `.extend` (`detectResourceLeaks` from `@queuert/helpers/testing`, the variance fixtures). Vitest requires a fixture's first parameter to be a destructuring pattern, so one that needs only `onCleanup` takes `({}, { onCleanup })` under a `no-empty-pattern` lint directive. Fixtures have no timeout of their own and their setup counts against the first test's, so specs start containers at module level (`const pg = await acquirePostgres("postgres:14", import.meta.url)`), where collection is not bounded by a test timeout.
- **Import `expect` from `vitest`**: Use the module-level `import { expect } from "vitest"` and don't destructure `expect` from the test context. Tests here run sequentially and use no snapshots, so the test-scoped `expect` adds nothing but a line in every parameter list. Reach for the context `expect` only in a test that runs with `.concurrent` or asserts snapshots, where Vitest needs it to attribute results to the right test. Conformance cases are not tests and use no `expect`: they assert with `node:assert/strict`, so they run under any runner.

### Conformance Cases

Conformance cases live in `packages/core/src/` as data (`ConformanceGroup`s): `conformance/` holds the runner-agnostic core (the group and case types, `toConformanceTestCases` and `retryUntilPasses`; cases assert with `node:assert/strict`, which needs no dependency and works under every runner), and each kind of case has a sibling `conformance.<kind>/` folder (`conformance.state-adapter/`, `conformance.notify-adapter/`, `conformance.validation-adapter/`, `conformance.end-to-end/`) with its context types in `types.ts`, its group sets in `groups.ts` (with the cases themselves in `cases/` when they span several files) and its public case lists in `*-cases.ts`. The public surface (`queuert/conformance`, the `…/conformance` entries of the adapter packages) turns them into lists of `ConformanceTestCase`s with `toConformanceTestCases`: plain data that drives no test runner, so users create and release resources in their own hooks and register one test per case with any runner (vitest, `node:test`, `bun:test`). Contract and end-to-end cases are separate public lists, so a user can run the fast contract cases on every change and the slower end-to-end ones apart, such as only in CI. Case titles are unique within every public list, and a spec checks it. Our own specs feed the same groups to `conformanceTestSuite` from the private `@queuert/helpers/conformance` entry, which registers each case as its own test and reads one file-scoped `conformance` fixture that the spec defines with `it.extend`. A case that needs a capability not every adapter has goes in its own group set, and each list composes the sets that apply (`stateAdapterBaseGroups` plus `stateAdapterConcurrentTransactionGroups` for PostgreSQL); a case never checks a capability flag and skips itself. Adapter packages export the composed provider cases and a `create…ConformanceContext` helper that builds their adapter from a provider, and their specs use the same composed group list and helper, so the public cases and our tests cannot drift. Provider case lists hold contract cases only: the adapter over the provider is ours, and our own specs run the end-to-end cases against it. Cases share one context per file, so a case must not depend on what earlier cases left behind, such as a notification still in flight for a key it listens on.

Every case runs in both modes from one body: `run: dynamicSyncAsync(function* (context) { … })` from `@queuert/sync-async`, a generator run without compiling, whose mode comes from the first `resource` it creates, the adapter under test (`sync: true` or its absence). Inside it, `yield* step(x)` stands for an adapter or client call the case makes directly, which must return a plain value over a sync adapter and a promise over an async one, so the same list checks the sync contract over a sync adapter; `yield* wait(x)` stands for work that is async in both modes (worker runner `start`/`stop`/`close`, `awaitChain`, `sleep`, `retryUntilPasses`, notification handoffs); context members such as `withNonTransactionContext` and `withWritesFenced` go through `step` with a non-`async` callback that returns the adapter's or client's result, which they pass through; and `const x = yield* resource(createX())` stands for `await using`. A step before the first `resource`, or one that breaks its mode, fails the case even inside a `try`, after the body's `finally` blocks run. Local helpers a case calls with `yield*` are `syncAsync(function* …)` functions called through `.steps`, and a transaction goes through the adapter's own `withTransaction`: its callback returns the adapter's or client's result, or, for a body of several steps, returns `runInModeOf(stateAdapter, syncAsync(function* () { … }))`, a sync-async function that uses `step` only and captures the callback's `txCtx`. Attempt handlers and other callbacks a case hands to the library stay `async`. Cases that only run in one mode live in their own group sets, like any capability: the async-only ones, which hold a transaction open across an await and may keep `async` bodies, in `stateAdapterAsyncGroups` and `endToEndAsyncGroups`, and the sync provider's own checks in `sqliteSyncStateProviderConformanceGroups`; a case never carries a mode of its own. Behaviour that differs by mode but exists in both stays in the base groups: the case reads the adapter's `sync` marker only to pick the outcome it asserts. The public suites add the async-only sets when called with `mode: "async"` (`createStateAdapterConformanceCases`, `createStateAdapterEndToEndConformanceCases`, `createSqliteStateProviderConformanceCases`), the same way an adapter that runs transactions in parallel opts into the concurrent sets with `concurrent: true`; the sync provider's checks still check the provider's `sync` marker and pass without running over an async provider. Our specs compose the sets that match the adapter's mode, so a spec registers no case that would pass without running. Cases that hold two transactions open at once live in their own `…ConcurrentTransactionGroups` lists, unwrapped, which only adapters that run transactions in parallel compose. Cases that expect one transaction to wait for another's lock live in `…LockWaitGroups` sets next to the async or concurrent set they extend (`stateAdapterAsyncLockWaitGroups`, `stateAdapterConcurrentTransactionLockWaitGroups`, `endToEndConcurrentTransactionLockWaitGroups`), which an adapter whose transactions never wait for a lock, such as Redis, leaves out. The base sets hold only cases that run in both modes, and there is never a separate `sync…` copy of a set.

### End-to-End Cases

End-to-end cases are conformance groups in `packages/core/src/conformance.end-to-end/cases/`, one file per area (`chains.ts`, `process.ts`, `worker.ts`, …), typed `ConformanceGroup<StateAdapterConformanceContext>`, except the notify groups, typed `ConformanceGroup<EndToEndNotifyContext>`. They are public suites of their own, next to the contract cases, and must stay fast: a case waits only as long as the behaviour it checks needs (a scheduling delay, a lease expiring), never on a long poll or backoff interval, so every case passes within a test runner's default timeout. Like the other conformance cases, each case creates its adapters from the context's factories with `resource` (the state adapter through `createCaseStateAdapter`, the notify adapter through `createCaseNotifyAdapter`, which falls back to an in-process one when the context has no `createNotifyAdapter`) and builds its own client, processors and worker runners over them, so the same case runs over every state and notify adapter:

- **Group sets**: `conformance.end-to-end/groups.ts` composes the base groups (every adapter), the notify groups (cases that need notifications delivered, which a noop notify adapter cannot run) and the concurrent-transaction groups (adapters that run transactions in parallel). `createStateAdapterEndToEndConformanceCases` always runs the base and notify groups, adds the async groups with `mode: "async"`, and adds the concurrent-transaction groups and the notify concurrent-transaction groups (`endToEndNotifyConcurrentTransactionGroups`, cases that need both notifications delivered and transactions run in parallel) with `concurrent: true`. `createNotifyAdapterEndToEndConformanceCases` runs the notify groups directly: their context makes the state adapter optional, and `createCaseStateAdapter` falls back to an in-process one of the context's `mode`. The provider case lists of the adapter packages hold no end-to-end cases; the adapter packages' own specs run these sets.
- **Capability groups**: a case that needs a capability not every adapter has (`withSavepoint`, `poisonTransaction`, `createFlakyDbStateAdapter`) goes in a group typed on the context that carries it (`EndToEndSavepointContext`, …). These sets and their context types are exported from `queuert/conformance-internal` only, and our PostgreSQL, SQLite and MySQL specs build a context with the capabilities their adapter supports and run those sets, so running a group without its capability fails to compile.
- **Type assertions** (`expectTypeOf`, type-only `@ts-expect-error` checks) live in a `<module>.types.spec.ts` next to the module whose API they check (`client.types.spec.ts` for the client methods, `job-type-processors/create-job-type-processors.types.spec.ts` for attempt handler typing), since cases run on the runner-agnostic `expect`.
- **No `vi` mocks or spies**: to change what an adapter does, spread it and override the method with a plain function: `{ ...stateAdapter, extendWorkerLease: async () => undefined }`, or wrap it with `createSpyStateAdapter`, `createFlakyStateAdapter` or `createFlakyNotifyAdapter` from `conformance.end-to-end/support/`. When only the first call should differ, mark it with an `AbortController` and fall through to the real method once `signal.aborted` is set. Assert the outcome the test can observe, such as the job's state or an assertion inside the handler, rather than call counts or arguments. Spec helpers and unit specs may keep using `vi` mocks.

### File Organization

**Spec helpers** (`*.spec-helper.ts`):

- Fixtures and context extensions consumed by specs (the variance fixture functions `variancePool` or `varianceDb`, `varianceConformance` and `varianceTableNames`, and the end-to-end context helpers that build a context with an adapter's capabilities). Named by suffix so they are excluded from test discovery.

**Spec files** (`*.spec.ts`):

Every test file uses `.spec.ts` — both unit tests colocated next to the module they cover (`entities/backoff.spec.ts`, `entities/chain.spec.ts`) and adapter-parameterized specs in a `specs/` directory. Do not use `.test.ts`.

- `packages/core/src/specs/` - Running with in-process adapters
- `packages/postgres/src/specs/` - Running with PostgreSQL adapter; `specs-pg/` holds the conformance and end-to-end specs over the `pg` driver
- `packages/sqlite/src/specs/` - Running with SQLite adapter; `specs-better-sqlite3/` holds the conformance and end-to-end specs over `better-sqlite3`
- `packages/mysql/src/specs/` - Running with MySQL / MariaDB adapter; `specs-mysql2/` holds the conformance and end-to-end specs over `mysql2`
- `packages/redis/src/specs/` - Running with Redis notify adapter; `specs-ioredis/`, `specs-node-redis/` and `specs-node-redis-cluster/` hold the notify and state adapter conformance specs per client, and `specs-ioredis/` also holds the state adapter's end-to-end, cluster, migration, job-lock and reliability specs
- `packages/nats/src/specs/` - Running with NATS notify adapter
- `packages/ipc/src/specs/` - Running with the IPC notify adapter

## Commands

```bash
pnpm fmt        # Format code (run before checks)
pnpm lint       # Run linter
pnpm typecheck  # Run type checking
pnpm test       # Run tests
pnpm check      # Run all checks together
```

## Examples

### Layout

Examples are grouped by the stack a reader runs, because a PostgreSQL user should find everything for PostgreSQL in one place and nothing else:

- `examples/<stack>/` holds a stack's state examples (`state-<driver>`), its notify examples (`notify-<broker>-<client>`, kept with the state database they run on) and `multi-worker`. The stacks are `postgresql/`, `sqlite/`, `mysql/`, `redis/`, `ipc/` (the IPC notify adapter) and `custom/` (adapters written from scratch). `postgresql/onboarding` holds the code tour of the home page.
- `examples/guides/` is one package with one file per guide (`src/job-blockers.ts`), small enough to read in one sitting, embedded by the guide it belongs to. A guide that cannot run there gets its own `examples/guides-xxx/` package (`guides-slices`, whose subject is a multi-file layout). Application migrations are part of the state examples: each runs a few in `src/migrations.ts`, and the Application Migrations guide embeds `postgresql/state-postgres-js`, which also runs two migrators at once, an `after` script and a revert.
- Examples not tied to a stack are grouped by concern: `log/` (`console`, `pino`, `winston`), `validation/` (`zod`, `valibot`, `typebox`, `arktype` for schema libraries whose stored form equals the runtime form, and `codec-zod`, `codec-superjson` for codecs whose runtime form differs from the stored form) and `observability/` (`otel`, `dashboard`).

A package is named `example-` plus its path with `/` replaced by `-` (`examples/postgresql/state-pg` is `example-postgresql-state-pg`), and the docs registry (`docs/src/data/examples.ts`) names it by its path (`postgresql/state-pg`).

### Single-Purpose Design

Each example demonstrates **one integration concern**:

- **State examples** other than `multi-worker` pass no notify adapter, so the client's in-process default wakes their worker runner. Each SQL driver example creates a chain in the same transaction as an application write and completes its job inside a transaction opened with its own client
- **Notify examples** keep their state in the PostgreSQL state example of the same client (`example-postgresql-state-pg/provider`, `example-postgresql-state-postgres-js/provider` or, under Bun, `example-postgresql-state-bun-sql/provider`) and wait for results with `awaitChain`. `ipc/notify` is the exception: its adapter is a `NotifyAdapter<"sync">` that connects processes on one host, so its processes share a SQLite file through `example-sqlite-state-better-sqlite3/provider`. `custom/notify-memory` is the other exception: its adapter reaches only the current process, so it keeps its state in the custom state adapter of `example-custom-state-memory/state-adapter`
- **Guide examples** keep their state in the in-process state adapter with `mode: "async"`, so they need no database and their code reads like the asynchronous drivers readers use
- **`postgresql/onboarding`** keeps its state in PostgreSQL through `example-postgresql-state-drizzle/provider`, the stack of the home page tour
- **Every other example** keeps its state in an in-memory SQLite database through `example-sqlite-state-better-sqlite3/provider` with `createSqliteStateAdapter` and `createClient`

This ensures users can copy-paste relevant code without untangling unrelated integrations.

### State Examples

State examples showcase the database client integrations for PostgreSQL, SQLite, MySQL / MariaDB and Redis, and a custom state adapter written from scratch:

```
postgresql/state-pg           # node-postgres (pg)
postgresql/state-postgres-js  # postgres.js
postgresql/state-drizzle      # Drizzle ORM
postgresql/state-kysely       # Kysely
postgresql/state-prisma       # Prisma
postgresql/state-knex         # Knex
postgresql/state-mikro-orm    # MikroORM
postgresql/state-bun-sql      # Bun.SQL
postgresql/multi-worker       # worker processes sharing one database, PostgreSQL notify

sqlite/state-better-sqlite3   # better-sqlite3
sqlite/state-node-sqlite      # node:sqlite
sqlite/state-drizzle          # Drizzle ORM
sqlite/state-kysely           # Kysely
sqlite/state-prisma           # Prisma
sqlite/state-knex             # Knex
sqlite/state-mikro-orm        # MikroORM
sqlite/state-bun-sqlite       # bun:sqlite
sqlite/state-bun-sql          # Bun.SQL
sqlite/multi-worker           # worker processes sharing one SQLite file, IPC notify

mysql/state-mysql2            # mysql2 (experimental MySQL / MariaDB state adapter)
mysql/state-mariadb           # mariadb connector, on MariaDB
mysql/state-drizzle           # Drizzle ORM
mysql/state-kysely            # Kysely
mysql/state-prisma            # Prisma
mysql/state-knex              # Knex
mysql/state-mikro-orm         # MikroORM
mysql/state-bun-sql           # Bun.SQL
mysql/multi-worker            # worker processes sharing one database, polling

redis/state-ioredis           # ioredis (experimental Redis state adapter)
redis/state-redis             # node-redis (experimental Redis state adapter)
redis/multi-worker            # worker processes sharing one Redis, Redis notify

custom/state-memory           # custom StateAdapter over in-memory maps
```

Each driver example implements a state provider (`PgStateProvider`, `MysqlStateProvider` or `SqliteStateProvider`, in either mode for SQLite) with `withTransaction`, `getTransaction` and `executeSql` methods specific to that client library. Except for the MikroORM ones, it also runs a few application migrations (`src/migrations.ts`) with `createPgMigrator`, `createMysqlMigrator` or `createSqliteMigrator`, and `src/provider.spec.ts` runs the migrator conformance cases alongside the provider cases. The better-sqlite3, node:sqlite, Drizzle and bun:sqlite examples run statements synchronously, so they implement a `SqliteStateProvider<…, "sync">`, and `createSqliteStateAdapter`, `createClient` and `withTxHooks` run synchronously over it; a client over a sync state adapter takes only a sync notify adapter. The Redis examples implement a `RedisStateProvider`, a single `eval` with SHA caching, run only the adapter's own `migrateToLatest()`, and run the cases from `createRedisStateProviderConformanceCases`. The custom example implements `StateAdapter` itself and validates it in `src/state-adapter.spec.ts` by registering one test per case from `createStateAdapterConformanceCases` and `createStateAdapterEndToEndConformanceCases` from `queuert/conformance`.

### Notify Examples

Notify examples showcase different pub/sub client integrations:

```
postgresql/notify-pg                        # pg (node-postgres)
postgresql/notify-postgres-js               # postgres-js
postgresql/notify-bun-sql                   # Bun.SQL
postgresql/notify-redis-ioredis             # ioredis
postgresql/notify-redis-redis               # node-redis
postgresql/notify-redis-bun                 # Bun Redis
postgresql/notify-redis-cluster-ioredis     # ioredis, Redis Cluster
postgresql/notify-redis-cluster-node-redis  # node-redis, Redis Cluster
postgresql/notify-nats                      # NATS
ipc/notify                                  # IPC between processes on one host
custom/notify-memory                        # custom NotifyAdapter, in-process listeners
```

Redis examples implement a `RedisNotifyProvider` with `subscribe` and `eval` methods. PostgreSQL examples implement a `PgNotifyProvider` with `publish` (a batch of messages in one statement) and `subscribe` methods using PostgreSQL's LISTEN/NOTIFY. The custom example implements `NotifyAdapter` itself and validates it in `src/notify-adapter.spec.ts` by registering one test per case from `createNotifyAdapterConformanceCases` and `createNotifyAdapterEndToEndConformanceCases` from `queuert/conformance`.

### Notify Adapter Conventions

**Prefix naming**: Each notify adapter uses domain-appropriate terminology for its prefix option:

- Postgres/Redis: `channelPrefix` (pub/sub channels)
- NATS: `subjectPrefix` (NATS uses "subjects" as its messaging primitive)
- IPC: `directory` (processes find each other through registry files in a shared directory)

This follows the principle of using each technology's native terminology rather than forcing artificial consistency.

**Provider types**: Postgres and Redis export provider types (`PgNotifyProvider`, `RedisNotifyProvider`) because users implement these interfaces with their chosen client library. NATS does not export a provider type because it accepts the `NatsConnection` from `@nats-io/nats-core` directly — no adapter layer is needed since every official `@nats-io` transport (Node, Deno, WebSocket) produces that same connection type. IPC does not export a provider type either: it owns its sockets and registry files, so there is no client library to bridge.

### State Adapter Conventions

State adapters have configuration differences that reflect database capabilities:

| Option           | PostgreSQL              | SQLite                  | Redis                   | Rationale                                                                      |
| ---------------- | ----------------------- | ----------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| Namespace        | `schema`                | `tablePrefix`           | `keyPrefix`             | PostgreSQL uses schemas; SQLite prefixes table names; Redis prefixes every key |
| Job ID generator | `generateJobId` (JS fn) | `generateJobId` (JS fn) | `generateJobId` (JS fn) | Every adapter generates IDs in JS for symmetry                                 |
| Job ID validator | `validateJobId`         | `validateJobId`         | `validateJobId`         | Optional predicate runs on generated and caller-supplied IDs                   |

### In-Process Adapters

The in-process state and notify adapters (`createInProcessStateAdapter` and `createInProcessNotifyAdapter`, synchronous by default and asynchronous with `mode: "async"`) are exported from `queuert`. They hold state only in memory and reach only the current process, like a Redis state adapter they do not commit with application data, and they suit tests, scripts and single-process apps that need no persistence. Their transaction context stays opaque: `InProcessContext` is not exported. Specs, benchmarks, the browser dashboard demo and `examples/guides/` import them from `queuert`; `queuert/conformance-internal` holds only conformance groups and seeding helpers. `createClient` without `notifyAdapter` uses an in-process notify adapter internally, scoped to that client.

### Code Style for Examples

Examples should follow these conventions for clarity and readability:

- **Top-level await**: Use top-level await directly, not wrapped in `main().catch()` or similar
- **Direct transaction patterns**: Use database client transactions directly (e.g., `db.transaction()`, `sql.begin()`) instead of abstracting through `stateProvider.withTransaction()` in the demonstration code
- **Simple patterns**: Prefer straightforward code over abstraction layers — examples should be copy-paste friendly
- **No obvious comments**: Users are smart
- **Workflow visualization**: Examples with job chains should include ASCII workflow diagrams as comments inside the `defineJobTypes` generic, directly above the relevant job type definitions
- **Region markers are load-bearing**: `// #region <name>` markers in `examples/` are embedded by the docs site, so renaming or removing one breaks `pnpm docs:build`; update the `<ExampleCode>` reference in the same change

### Guides and Examples Stay in Sync

Each guide in `docs/src/content/docs/guides/` embeds its code from `examples/guides/src/<guide>.ts`: the MDX renders a region with `<ExampleCode example="guides" file="src/<guide>.ts" region="<name>" />`. The example is the source of truth for correctness because it runs in `pnpm examples`; the guide is the source of truth for teaching:

- **Every snippet the guide shows is a region of the example**: a guide section shows a diagram, the region and its explanation. Keep demo scaffolding (assertions, setup the reader does not need) outside the regions, or inside `// #hide` … `// #endhide`.
- **Keep each guide file small**: one file covers one guide, with only the scenarios the guide teaches.
- **Change both together**: a change to a region rewrites the prose around it, and a guide edit that changes a pattern changes the example.

## Documentation Updates

When making changes:

- Update `README.md` if there were changes to public API
- Update `CLAUDE.md` only to modify session instructions (commands, workflow requirements, high-level links)
- Update `docs/src/content/docs/` if there were architectural changes or naming convention updates
- Update package READMEs (`packages/*/README.md`) if there were changes to adapter exports or configuration
- Update `TODO.md` if any items were addressed
- Update the dashboard demo seed whenever a change to `packages/dashboard` needs new data to show a documented view (see below)

### Docs Site

[Docs Style](docs-style.md) is the source of truth for the docs site in `docs/`: site layout, the MDX pipeline, where a page's sidebar entry goes, visual language and how to verify a docs change. Read it before changing a page.

### Dashboard Demo

`docs/src/content/docs/integrations/dashboard.tsx` shows the live dashboard in place of screenshots: each `<DashboardDemo view="…">` frame (`docs/src/components/integrations/dashboard/DashboardDemo.tsx`) opens one view. A service worker (`demo/service-worker.ts`, bundled by `docs/plugins/dashboard-demo-worker.ts` to `/queuert/dashboard-demo.js`) runs a `createDashboard` fetch handler in the browser, so the frames load the regular `@queuert/dashboard` build, which `pnpm docs:dev` and `pnpm docs:build` build first.

- The data comes from `examples/observability/dashboard/src/scenarios.ts`, which both the example's populator (SQLite) and the demo's `demo/seed.ts` (in-process adapter) run, so the example and the docs show the same chains, jobs and workers
- IDs come from the scenarios' seeded `createIdGenerator` and each scenario's writes are awaited before the next starts, so a run always yields the same IDs; the demo relies on it, since the browser stops an idle service worker and the reseed must keep open frames working
- `seedDashboardDemo` returns the path of every documented view, and the frame opens `__view/<view>`, which the service worker redirects to that path; a new view gets its path there and a `view` value on the page
- A dashboard change that needs data no scenario has (a new status, a new kind of row) adds a scenario to `scenarios.ts`, and the prose next to the frame is updated to match
