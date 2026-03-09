# Code Style

## Overview

This document describes code style conventions, testing patterns, and project organization for Queuert development.

## General Principles

- **Inline types used in only one place**: Don't create separate type definitions for types used once. This applies to function parameters, return types, and generic type arguments — embed them directly in the function signature instead of extracting a named type alias
- **Remove obvious comments**: Code should be self-documenting; comments explain "why", not "what"
- **Merge similar functionality**: Look for patterns and consolidate before adding new code
- **Search before implementing**: Check for similar existing implementations before adding new features
- **Typed error classes**: Use specific error types for all thrown errors (`JobNotFoundError`, `JobAlreadyCompletedError`, etc.) to enable proper error handling by consumers. Generic `Error` should only be used for truly unreachable code paths (assertion-style guards). If a caller could reasonably need to catch and handle an error, it must have a specific type.
- **Factory functions over classes**: Expose `createClient()` instead of `new Client()`. Classes can be used internally, but the public API should always be factory functions. This keeps constructors private, allows async initialization, and makes the API consistent.
- **Nullable conventions**: Use `undefined` for "not found/not present" and `null` for "explicitly set to no value". For example, `getJobById` returns `undefined` when job doesn't exist, while `job.completedAt` is `null` before completion.
- **Prefer explicit context passing over async context**: Use parameters, callbacks, and handles to pass context rather than relying on `AsyncLocalStorage` or `async_hooks`. The library does not bind or snapshot async context internally — callers (e.g., OTEL adapters) are responsible for propagating their own async context.
- **No abbreviated names**: Use full words in variable names, type names, and type parameters. Write `TDefinitions` not `TDefs`, `definitions` not `defs`, `config` not `cfg`. Single-letter type parameters (`T`, `K`) are fine when there's only one and the meaning is obvious. `ctx`/`TCtx` is also acceptable as a well-established abbreviation.
- **Consistent pluralization**: Keep singular/plural consistent across related names — including functions, types, type parameters, variables, and file names. If a function is `defineJobTypeRegistry` (plural), related type parameters and variables should also use plural — e.g., `TJobTypeDefinitions` not `TJobTypeDefinition`, `jobTypeRegistry` not `jobType` (when referring to the collection).
- **Arrow functions over function declarations**: Use `export const fn = () => {}` instead of `export function fn() {}`. This applies to all exports — named functions, factories, helpers, etc.
- **Async factory functions**: Factory functions that perform I/O (database setup, network connections) should be async. Pure configuration factories like `createConsoleLog` or `createJobTypeRegistry` should be sync. Note: `createOtelObservabilityAdapter` is async for future-proofing even though current OTEL instrument creation is synchronous.
- **No barrel files**: Do not create `index.ts` barrel re-export files within subdirectories. The only barrel file is each package's top-level `index.ts` (the package entry point). Internal modules import directly from the source file they need.
- **No type re-exports from non-owning modules**: A module should only export types it defines. Do not import a type from its source module just to re-export it — consumers should import directly from the module that owns the type. The only exception is each package's top-level `index.ts` entry point.
- **Symbol descriptions prefixed with `queuert.`**: All internal `Symbol()` instances must use a `"queuert."` prefix in their description string, e.g. `Symbol("queuert.helpers")`. This makes symbols identifiable in debugging and avoids collisions.

## Naming Conventions

### Avoid Redundant Package Prefixes

Public exports should not include the package name as a prefix. Since imports already provide namespace context, repeating it is redundant:

```typescript
// Good - context from import is sufficient
import { createClient, createInProcessWorker, Client } from "queuert";

// Bad - redundant prefix
import { createQueuertClient, createQueuertInProcessWorker, QueuertClient } from "queuert";
```

### Prefer "jobChain" over "chain"

In variable names, documentation, and comments, use `jobChain` (not `chain`) to be explicit about what's being referenced. The abbreviated form `chain` is acceptable only in compound API names where the `Job` prefix is already present (e.g., `listJobChainJobs`, `JobChain`, `startJobChain`).

```typescript
// Good
const jobChain = await client.getJobChain({ id });
const jobChains = await client.listJobChains({ filter });

// Bad - ambiguous abbreviation
const chain = await client.getJobChain({ id });
const chains = await client.listJobChains({ filter });
```

### Concise Error Names

Error class names should be descriptive but not excessively long. Prefer shorter names that still clearly convey the error:

```typescript
// Good
WaitChainTimeoutError;

// Bad - unnecessarily verbose
WaitForJobChainCompletionTimeoutError;
```

### Core Package Exports

The core `queuert` package exports these primary factory functions and types:

| Export                  | Description                                           |
| ----------------------- | ----------------------------------------------------- |
| `createClient`          | Creates a client for starting and managing job chains |
| `Client`                | Type for the client instance                          |
| `createInProcessWorker` | Creates an in-process worker for processing jobs      |
| `InProcessWorker`       | Type for the worker instance                          |

### Adapter Package Exports

Adapter packages use their domain-specific prefixes (not "Queuert"):

| Package              | Factory Function                 | Type                 |
| -------------------- | -------------------------------- | -------------------- |
| `@queuert/postgres`  | `createPgStateAdapter`           | `PgStateAdapter`     |
| `@queuert/postgres`  | `createPgNotifyAdapter`          | -                    |
| `@queuert/sqlite`    | `createSqliteStateAdapter`       | `SqliteStateAdapter` |
| `@queuert/redis`     | `createRedisNotifyAdapter`       | -                    |
| `@queuert/nats`      | `createNatsNotifyAdapter`        | -                    |
| `@queuert/otel`      | `createOtelObservabilityAdapter` | -                    |
| `@queuert/dashboard` | `createDashboard`                | -                    |

## Reference Documentation

Reference docs in `docs/src/content/docs/advanced/` capture architectural decisions and API contracts as part of the documentation site.

## Testing Patterns

### General Guidelines

- Embed small verification tests into existing related tests rather than creating separate ones
- Test all relevant phases: `prepare`, `process`, `complete`
- Prefer descriptive test names that match what's being tested
- To enable verbose logging when debugging tests, run with `DEBUG=1` environment variable

### Test Suites

Test suites are reusable test collections exported as functions. They receive Vitest's `it` function and a typed context, allowing the same tests to run across different configurations (e.g., different database adapters):

```typescript
// Define a test suite
export const myFeatureTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("does something", async ({ stateAdapter, runInTransaction, expect }) => {
    // test implementation
  });

  it("does something else", async ({ stateAdapter, expect }) => {
    // test implementation
  });
};

// Use the test suite in a spec file
describe("MyFeature", () => {
  myFeatureTestSuite({ it });
});
```

### File Organization

**Test suites** (`*.test-suite.ts`):

- `packages/core/src/suites/` - Reusable test suite files, exported via `queuert/testing`

**Spec files** (`*.spec.ts`):

- `packages/core/src/specs/` - Running with in-process adapters
- `packages/postgres/src/specs/` - Running with PostgreSQL adapter
- `packages/sqlite/src/specs/` - Running with SQLite adapter
- `packages/redis/src/specs/` - Running with Redis notify adapter
- `packages/nats/src/specs/` - Running with NATS notify adapter

## Commands

```bash
pnpm fmt        # Format code (run before checks)
pnpm lint       # Run linter
pnpm typecheck  # Run type checking
pnpm test       # Run tests
pnpm check      # Run all checks together
```

## Examples

### Naming Convention

Examples are organized by prefix to indicate their primary focus:

- `log-xxx`: Logging adapter integration
- `observability-xxx`: OpenTelemetry and metrics
- `state-xxx`: State adapter examples (PostgreSQL, SQLite, etc.)
- `notify-xxx`: Notify adapter examples (Redis, NATS, etc.)
- `validation-xxx`: Runtime validation with schema libraries
- `showcase-xxx`: Feature demonstrations combining multiple concerns
- `benchmark-xxx`: Performance measurement and benchmarks

### Single-Purpose Design

Each example demonstrates **one integration concern**:

- **State examples** use `createInProcessNotifyAdapter` from `queuert/internal`
- **Notify examples** use `createInProcessStateAdapter` from `queuert/internal`

This ensures users can copy-paste relevant code without untangling unrelated integrations.

### State Examples

State examples showcase different database client integrations with the same database:

```
state-postgres-pg           # node-postgres (pg)
state-postgres-postgres-js  # postgres.js
state-postgres-prisma       # Prisma
state-postgres-drizzle      # Drizzle ORM
state-postgres-kysely       # Kysely

state-sqlite-better-sqlite3 # better-sqlite3
state-sqlite-sqlite3        # sqlite3
state-sqlite-prisma         # Prisma
state-sqlite-drizzle        # Drizzle ORM
state-sqlite-kysely         # Kysely

```

Each implements a state provider (`PgStateProvider` or `SqliteStateProvider`) with `runInTransaction` and `executeSql` methods specific to that client library.

### Notify Examples

Notify examples showcase different pub/sub client integrations:

```
notify-redis-redis           # node-redis
notify-redis-ioredis         # ioredis
notify-postgres-pg           # pg (node-postgres)
notify-postgres-postgres-js  # postgres-js
```

Redis examples implement a `RedisNotifyProvider` with `publish`, `subscribe`, and `eval` methods. PostgreSQL examples implement a `PgNotifyProvider` with `publish` and `subscribe` methods using PostgreSQL's LISTEN/NOTIFY.

### Notify Adapter Conventions

**Prefix naming**: Each notify adapter uses domain-appropriate terminology for its prefix option:

- Postgres/Redis: `channelPrefix` (pub/sub channels)
- NATS: `subjectPrefix` (NATS uses "subjects" as its messaging primitive)

This follows the principle of using each technology's native terminology rather than forcing artificial consistency.

**Provider types**: Postgres and Redis export provider types (`PgNotifyProvider`, `RedisNotifyProvider`) because users implement these interfaces with their chosen client library. NATS does not export a provider type because it accepts the `NatsConnection` directly from the `nats` package — no adapter layer is needed since there's only one NATS client implementation in the Node.js ecosystem.

### State Adapter Conventions

State adapters have configuration differences that reflect database capabilities:

| Option       | PostgreSQL             | SQLite                | Rationale                                                   |
| ------------ | ---------------------- | --------------------- | ----------------------------------------------------------- |
| Namespace    | `schema`               | `tablePrefix`         | PostgreSQL uses schemas; SQLite prefixes table names        |
| ID default   | `idDefault` (SQL expr) | N/A                   | PostgreSQL can use SQL expressions like `gen_random_uuid()` |
| ID generator | N/A                    | `idGenerator` (JS fn) | SQLite needs app-side ID generation                         |

These differences are intentional — each adapter uses the most natural approach for its database.

### In-Process Adapters

The in-process adapters (`createInProcessStateAdapter`, `createInProcessNotifyAdapter`) are exported from `queuert/internal`, not the main entry point. They're intended for:

- Testing (used in test suites and examples)
- Single-purpose examples (state examples use in-process notify, notify examples use in-process state)
- Development/prototyping

Production deployments should use the database-backed adapters from their respective packages.

### Code Style for Examples

Examples should follow these conventions for clarity and readability:

- **Top-level await**: Use top-level await directly, not wrapped in `main().catch()` or similar
- **Direct transaction patterns**: Use database client transactions directly (e.g., `db.transaction()`, `sql.begin()`) instead of abstracting through `stateProvider.runInTransaction()` in the demonstration code
- **Simple patterns**: Prefer straightforward code over abstraction layers — examples should be copy-paste friendly
- **No obvious comments**: Users are smart
- **Workflow visualization**: Examples with job chains should include ASCII workflow diagrams as comments inside the `defineJobTypeRegistry` generic, directly above the relevant job type definitions

## Documentation Updates

When making changes:

- Update `README.md` if there were changes to public API
- Update `CLAUDE.md` only to modify session instructions (commands, workflow requirements, high-level links)
- Update `docs/src/content/docs/` if there were architectural changes or naming convention updates
- Update package READMEs (`packages/*/README.md`) if there were changes to adapter exports or configuration
- Update `TODO.md` if any items were addressed
