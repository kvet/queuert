# Code Style

## Overview

This document describes code style conventions, testing patterns, and project organization for Queuert development.

## General Principles

- **Inline types used in only one place**: Don't create separate type definitions for types used once
- **Remove obvious comments**: Code should be self-documenting; comments explain "why", not "what"
- **Merge similar functionality**: Look for patterns and consolidate before adding new code
- **Search before implementing**: Check for similar existing implementations before adding new features
- **Typed error classes**: Use specific error types for public-facing errors (`JobNotFoundError`, `JobAlreadyCompletedError`, etc.) to enable proper error handling by consumers. Internal assertion errors can remain as generic `Error`.

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
- `packages/mongodb/src/specs/` - Running with MongoDB adapter
- `packages/redis/src/specs/` - Running with Redis notify adapter
- `packages/nats/src/specs/` - Running with NATS notify adapter

## Type Organization

Source files are organized by domain:

- `job-type.ts`: Base type definitions (`BaseJobTypeDefinition`) and `defineJobTypes` factory
- `job-type-registry.ts`: Runtime validation types (`JobTypeRegistry`, `JobTypeRegistryConfig`) and factories
- `job-type.navigation.ts`: Type-level navigation logic (`JobOf`, `ChainJobTypes`, `ContinuationJobTypes`)
- `job-type.validation.ts`: Compile-time validation types (`ValidatedJobTypeDefinitions`)
- `job-chain.types.ts`: Core entity types (`JobChain`, `CompletedJobChain`, `JobChainStatus`)
- `job.types.ts`: Core job entity types (`Job`, `JobWithoutBlockers`) and status narrowing types

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

state-mongodb-mongodb       # mongodb native driver
state-mongodb-mongoose      # Mongoose ODM
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

### Code Style for Examples

Examples should follow these conventions for clarity and readability:

- **Top-level await**: Use top-level await directly, not wrapped in `main().catch()` or similar
- **Direct transaction patterns**: Use database client transactions directly (e.g., `db.transaction()`, `sql.begin()`) instead of abstracting through `stateProvider.runInTransaction()` in the demonstration code
- **Simple patterns**: Prefer straightforward code over abstraction layers — examples should be copy-paste friendly
- **No obvious comments**: Users are smart
- **Workflow visualization**: Examples with job chains should include ASCII workflow diagrams as comments inside the `defineJobTypes` generic, directly above the relevant job type definitions

## Documentation Updates

When making changes:

- Update `README.md` if there were changes to public API
- Update `CLAUDE.md` only to add/remove links to design docs or packages (it's an index, not a knowledge base)
- Update `docs/design/*.md` if there were architectural changes or naming convention updates
- Update package READMEs (`packages/*/README.md`) if there were changes to adapter exports or configuration
- Update `TODO.md` if any items were addressed
