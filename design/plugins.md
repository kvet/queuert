# Module & Plugin System Design

## Core Principle

Adapters and plugins are **modules** — parameterized packages that export typed pieces for each integration point. Users explicitly wire each piece where it's needed. No auto-extraction, no hidden merging, no `[helpersSymbol]` internals.

```
Module = parameterized factory → typed exports for each consumer
```

Each integration point (`createClient`, `createInProcessWorker`, `createDashboard`) declares exactly what it needs. Singleton slots (state adapter, notify adapter) are structural — a single required field, not an array. Additive capabilities use named parameters that describe what they do (`extensions`, `handlerWrappers`), not a generic `plugins` bag.

---

## Module Anatomy

A module is a factory function that takes configuration and returns a bag of typed exports. Each export targets a specific integration point.

```typescript
import { createPgStateModule } from "@queuert/state-postgres";

const pgState = createPgStateModule({ stateProvider });
```

What `pgState` exposes (all typed, all optional based on config):

```typescript
pgState.clientAdapter; // StateClientAdapter — for createClient
pgState.workerAdapter; // StateWorkerAdapter — for createInProcessWorker

pgState.maintenance; // Bundled maintenance capabilities
pgState.maintenance.jobTypeRegistry; // Job types for cleanup + partitions
pgState.maintenance.clientExtension; // methods + lifecycle: triggerCleanup(), onCreate
pgState.maintenance.jobTypeProcessorRegistry; // Processor slice for maintenance worker
pgState.maintenance.dashboardExtension; // Dashboard pages for maintenance status
```

The user picks what they need at each site. Nothing is implicit.

---

## Adapter Split by Consumer

Adapters are split into consumer-specific interfaces. Each integration point (`createClient`, `createInProcessWorker`, `createDashboard`, future modules) gets a tailored adapter exposing only the operations it needs.

The exact interface boundaries are TBD — today's client and worker share overlapping operations (e.g., `completeJob` and `createJobs` are used by both), so the split requires careful design. The key motivations:

1. **Explicit dependencies** — each consumer declares what it needs, not "the whole adapter"
2. **Future consumers** — dashboard, stats modules, or other integration points may need their own adapter subsets
3. **Independent evolution** — adding a `StateAdapter` method for a new consumer shouldn't force changes to unrelated consumers

The underlying implementation shares a connection pool; the split is at the interface level.

```typescript
// Conceptual — exact boundaries TBD
pgState.clientAdapter; // State operations for createClient
pgState.workerAdapter; // State operations for createInProcessWorker
// Future: pgState.dashboardAdapter, pgState.statsAdapter, etc.

redisNotify.clientAdapter; // Publish side (notify*)
redisNotify.workerAdapter; // Subscribe side (listen*)

otel.observabilityAdapter; // Unified for now — client and worker event types are disjoint
```

---

## Integration Point APIs

### createClient

```typescript
const client = await createClient({
  // Singleton slots (exactly one each)
  stateAdapter: pgState.clientAdapter,
  notifyAdapter: redisNotify.clientAdapter, // optional, defaults to noop
  observabilityAdapter: otel.observabilityAdapter, // optional, defaults to noop

  // Job type registry (required)
  jobTypeRegistry: mergeJobTypeRegistries({
    slices: [appJobTypeRegistry, pgState.maintenance.jobTypeRegistry],
  }),

  // Extensions add methods and lifecycle hooks to the client (zero or more)
  extensions: [pgState.maintenance.clientExtension],

  log: pinoLog, // optional
});
```

### createInProcessWorker

Worker receives its own adapters directly — no digging into client internals. The client reference is for processors to create jobs, query state, etc.

```typescript
const worker = await createInProcessWorker({
  // Worker's own adapters
  stateAdapter: pgState.workerAdapter,
  notifyAdapter: redisNotify.workerAdapter, // optional, defaults to noop
  observabilityAdapter: otel.observabilityAdapter, // optional, defaults to noop

  // Client reference (for processors)
  client,

  // Processor registry
  jobTypeProcessorRegistry: mergeJobTypeProcessorRegistries({
    slices: [appProcessors, pgState.maintenance.jobTypeProcessorRegistry],
  }),

  // Handler wrappers — onion layers around all handlers (zero or more)
  handlerWrappers: [audit.handlerWrapper],

  workerId: "worker-1",
  concurrency: 10,
});
```

### createDashboard

```typescript
const dashboard = createDashboard({
  client,
  // Extensions add pages, actions, and API routes to the dashboard
  extensions: [pgState.maintenance.dashboardExtension, stats.dashboardExtension],
  basePath: "/internal/queuert",
});
```

---

## Full API Examples

### Basic Setup (Single Process, In-Memory)

Equivalent to current `state-postgres-pg` example pattern.

```typescript
import { createPgStateModule } from "@queuert/state-postgres";
import { createInProcessNotifyModule } from "queuert/notify-in-process";
import {
  createClient,
  createInProcessWorker,
  defineJobTypeRegistry,
  createJobTypeProcessorRegistry,
  withTransactionHooks,
} from "queuert";

// --- Modules ---

const pgState = createPgStateModule({ stateProvider, schema: "public" });
await pgState.migrateToLatest();

const notify = createInProcessNotifyModule();

// --- App code ---

const jobTypeRegistry = defineJobTypeRegistry<{
  "orders.process": {
    entry: true;
    input: { orderId: string; amount: number };
    continueWith: { typeName: "orders.send-confirmation" };
  };
  "orders.send-confirmation": {
    input: { orderId: string; chargeId: string };
    output: { emailSent: boolean };
  };
}>();

// --- Client ---

const client = await createClient({
  stateAdapter: pgState.clientAdapter,
  notifyAdapter: notify.clientAdapter,
  jobTypeRegistry,
});

// --- Worker ---

const processors = createJobTypeProcessorRegistry({
  client,
  jobTypeRegistry,
  processors: {
    "orders.process": {
      attemptHandler: async ({ job, complete }) => {
        const chargeId = await chargeCard(job.input.amount);
        return complete(async ({ continueWith }) =>
          continueWith({
            typeName: "orders.send-confirmation",
            input: { orderId: job.input.orderId, chargeId },
          }),
        );
      },
    },
    "orders.send-confirmation": {
      attemptHandler: async ({ job, complete }) => {
        await sendEmail(job.input.orderId);
        return complete(async () => ({ emailSent: true }));
      },
    },
  },
});

const worker = await createInProcessWorker({
  stateAdapter: pgState.workerAdapter,
  notifyAdapter: notify.workerAdapter,
  client,
  jobTypeProcessorRegistry: processors,
});

const stopWorker = await worker.start();

// --- Enqueue ---

await withTransactionHooks(async (transactionHooks) =>
  pgState.clientAdapter.runInTransaction(async (txCtx) =>
    client.startJobChain({
      ...txCtx,
      transactionHooks,
      typeName: "orders.process",
      input: { orderId: "ORD-001", amount: 49_99 },
    }),
  ),
);
```

### Multi-Worker Setup (Horizontal Scaling)

Each process creates its own module instances with independent database connections. Workers are specialized — each handles only its registered job types.

```typescript
// === worker-maintenance.ts (Machine A) ===

import { createPgStateModule } from "@queuert/state-postgres";
import { createPgNotifyModule } from "@queuert/notify-postgres";
import { createOtelModule } from "@queuert/otel";

const pgState = createPgStateModule({ stateProvider: maintenancePool });
const pgNotify = createPgNotifyModule({ notifyProvider: maintenanceNotifyPool });
const otel = createOtelModule({ meter, tracer });

// Client needs ALL job type registries (for chain resolution),
// but the worker only processes maintenance jobs.
const client = await createClient({
  stateAdapter: pgState.clientAdapter,
  notifyAdapter: pgNotify.clientAdapter,
  observabilityAdapter: otel.observabilityAdapter,
  jobTypeRegistry: mergeJobTypeRegistries({
    slices: [appJobTypeRegistry, pgState.maintenance.jobTypeRegistry],
  }),
  extensions: [pgState.maintenance.clientExtension],
});

const worker = await createInProcessWorker({
  stateAdapter: pgState.workerAdapter,
  notifyAdapter: pgNotify.workerAdapter,
  observabilityAdapter: otel.observabilityAdapter,
  client,
  workerId: "maintenance-worker",
  concurrency: 2,
  jobTypeProcessorRegistry: pgState.maintenance.jobTypeProcessorRegistry,
});

const stop = await worker.start();
```

```typescript
// === worker-app.ts (Machines B-E) ===

const pgState = createPgStateModule({ stateProvider: appPool });
const pgNotify = createPgNotifyModule({ notifyProvider: appNotifyPool });
const otel = createOtelModule({ meter, tracer });

const client = await createClient({
  stateAdapter: pgState.clientAdapter,
  notifyAdapter: pgNotify.clientAdapter,
  observabilityAdapter: otel.observabilityAdapter,
  jobTypeRegistry: mergeJobTypeRegistries({
    slices: [appJobTypeRegistry, pgState.maintenance.jobTypeRegistry],
  }),
});

const worker = await createInProcessWorker({
  stateAdapter: pgState.workerAdapter,
  notifyAdapter: pgNotify.workerAdapter,
  observabilityAdapter: otel.observabilityAdapter,
  client,
  workerId: `app-worker-${machineId}`,
  concurrency: 20,
  jobTypeProcessorRegistry: appProcessors,
  // No pgState.maintenance.jobTypeProcessorRegistry — maintenance worker handles those
});

const stop = await worker.start();
```

### Feature Slices with Modules

Feature slices remain an organizational pattern. Modules bundle their own slices internally.

```typescript
// --- slice-orders/definitions.ts ---

import type { JobTypeRegistryDefinitions } from "queuert";
import type { notificationJobTypeRegistry } from "../slice-notifications/definitions.js";

export const orderJobTypeRegistry = defineJobTypeRegistry<
  {
    "orders.create": {
      entry: true;
      input: { productId: string; quantity: number };
      continueWith: { typeName: "orders.fulfill" };
    };
    "orders.fulfill": {
      input: { orderId: string };
      output: { shipped: boolean };
      blockers: [{ typeName: "notifications.verify-address" }];
    };
  },
  // External reference — type-checked at merge time
  JobTypeRegistryDefinitions<typeof notificationJobTypeRegistry>
>();
```

```typescript
// --- wiring.ts ---

import { createPgStateModule } from "@queuert/state-postgres";
import { createRedisNotifyModule } from "@queuert/notify-redis";
import { orderJobTypeRegistry, orderProcessors } from "./slice-orders/index.js";
import {
  notificationJobTypeRegistry,
  notificationProcessors,
} from "./slice-notifications/index.js";

const pgState = createPgStateModule({ stateProvider });
const redisNotify = createRedisNotifyModule({ redis });

const client = await createClient({
  stateAdapter: pgState.clientAdapter,
  notifyAdapter: redisNotify.clientAdapter,
  jobTypeRegistry: mergeJobTypeRegistries({
    slices: [
      orderJobTypeRegistry,
      notificationJobTypeRegistry,
      pgState.maintenance.jobTypeRegistry,
    ],
  }),
  extensions: [pgState.maintenance.clientExtension],
});

// All-in-one worker (single process)
const worker = await createInProcessWorker({
  stateAdapter: pgState.workerAdapter,
  notifyAdapter: redisNotify.workerAdapter,
  client,
  jobTypeProcessorRegistry: mergeJobTypeProcessorRegistries({
    slices: [orderProcessors, notificationProcessors, pgState.maintenance.jobTypeProcessorRegistry],
  }),
});
```

### Dashboard with Module Plugins

```typescript
import { createDashboard } from "@queuert/dashboard";
import { createPgStateModule } from "@queuert/state-postgres";

const pgState = createPgStateModule({ stateProvider });

const client = await createClient({
  stateAdapter: pgState.clientAdapter,
  jobTypeRegistry: mergeJobTypeRegistries({
    slices: [appJobTypeRegistry, pgState.maintenance.jobTypeRegistry],
  }),
  extensions: [pgState.maintenance.clientExtension],
});

const dashboard = createDashboard({
  client,
  basePath: "/internal/queuert",
  plugins: [
    pgState.maintenance.dashboardExtension,
    // Adds pages: /maintenance — cleanup & partition status
    // Adds actions: "Trigger Cleanup" on maintenance job views
  ],
});

// Mount in any framework
app.all("/internal/queuert/*", (req) => dashboard.fetch(req));
```

---

## Advanced: Precomputed Statistics Module

An example of a cross-cutting module that periodically queries the state adapter to precompute dashboard statistics (job counts by type/status, throughput rates, queue depths).

```typescript
import { createStatsModule } from "@queuert/stats";
import { createRedisEphemeralProvider } from "@queuert/ephemeral-redis";

// Ephemeral storage for precomputed stats (TTL-based, not durable)
const ephemeral = createRedisEphemeralProvider({ redis });

// Stats module depends on ephemeral storage (explicit injection)
const stats = createStatsModule({
  ephemeralProvider: ephemeral,
  computeIntervalMs: 30_000, // recompute every 30s
});

// --- Client ---

const client = await createClient({
  stateAdapter: pgState.clientAdapter,
  notifyAdapter: redisNotify.clientAdapter,
  observabilityAdapter: otel.observabilityAdapter,
  jobTypeRegistry: mergeJobTypeRegistries({
    slices: [
      appJobTypeRegistry,
      pgState.maintenance.jobTypeRegistry,
      stats.jobTypeRegistry, // stats.compute-snapshot job type
    ],
  }),
  extensions: [
    pgState.maintenance.clientExtension, // client.triggerCleanup(), client.getMaintenanceStatus()
    stats.clientExtension, // client.getStats(), client.getStatsHistory()
  ],
});

// --- Maintenance worker (handles stats computation jobs) ---

const maintenanceWorker = await createInProcessWorker({
  stateAdapter: pgState.workerAdapter,
  notifyAdapter: redisNotify.workerAdapter,
  observabilityAdapter: otel.observabilityAdapter,
  client,
  workerId: "maintenance",
  jobTypeProcessorRegistry: mergeJobTypeProcessorRegistries({
    slices: [
      pgState.maintenance.jobTypeProcessorRegistry,
      stats.jobTypeProcessorRegistry, // runs periodic queries against state adapter
    ],
  }),
});

// --- Dashboard with live stats ---

const dashboard = createDashboard({
  client,
  extensions: [
    pgState.maintenance.dashboardExtension,
    stats.dashboardExtension,
    // Adds: /stats page with charts (reads from ephemeral storage)
    // Adds: stats summary cards on the main dashboard
    // Adds: API route GET /api/plugins/stats/snapshot
  ],
});
```

### What the stats module does internally

```typescript
// stats.jobTypeProcessorRegistry handles "stats.compute-snapshot":
// 1. Queries state adapter: SELECT type_name, status, count(*) FROM jobs GROUP BY ...
// 2. Computes throughput: completed jobs in last 5m / 5m
// 3. Writes snapshot to ephemeral storage with TTL
// 4. Schedules next computation via continueWith (self-loop with schedule)

// stats.dashboardExtension reads snapshots from ephemeral storage
// to render charts without hitting the state adapter on every page load
```

---

## Handler Wrapping

Type-safe context injection via `next(ctx)` (tRPC-inspired). Modules export a `handlerWrapper` for use in `createInProcessWorker`'s `handlerWrappers` array.

```typescript
type HandlerPluginFacet<
  THandlerCtx extends Record<string, unknown> = {},
  TPrepareCtx extends Record<string, unknown> = {},
  TCompleteCtx extends Record<string, unknown> = {},
> = {
  wrapHandler?: <T>(opts: { job; workerId; next: (ctx: THandlerCtx) => Promise<T> }) => Promise<T>;
  wrapPrepare?: <T>(opts: { job; next: (ctx: TPrepareCtx) => Promise<T> } & TxCtx) => Promise<T>;
  wrapComplete?: <T>(
    opts: { job; transactionHooks; next: (ctx: TCompleteCtx) => Promise<T> } & TxCtx,
  ) => Promise<T>;
};
```

**Three registration scopes:**

1. **Worker-level** — plugin passed to `createInProcessWorker`. Applied to ALL handlers. Every `JobTypeProcessorRegistry` must be created with the plugin. Enforced at compile time. Outer onion layer.
2. **Merge-level** — plugin passed to `mergeJobTypeProcessorRegistries`. All input registries must conform. Enforced at compile time.
3. **Registry-level** — plugin passed to `createJobTypeProcessorRegistry`. Only that registry's handlers. Inner onion layer.

```
Execution: worker plugin 1 → worker plugin 2 → registry plugin 1 → registry plugin 2 → handler
```

### Example: Audit trail plugin with handler wrapping

```typescript
import { createAuditModule } from "@queuert/audit";

const audit = createAuditModule({ auditStore });

const worker = await createInProcessWorker({
  stateAdapter: pgState.workerAdapter,
  notifyAdapter: redisNotify.workerAdapter,
  client,
  jobTypeProcessorRegistry: appProcessors,
  // audit.handlerWrapper wraps all handlers with audit context
  handlerWrappers: [audit.handlerWrapper],
  // All handlers receive audit context via wrapComplete:
  // wrapComplete: async ({ job, next }) => next({ audit: createAuditTrail(job) })
});
```

**Migration:** Once implemented, remove `attemptMiddlewares` from `JobTypeProcessorDefaults`. `wrapHandler` fully subsumes it.

---

## Dashboard Extension Facet

The dashboard extension is defined by `@queuert/dashboard`, not the core package. Modules export a `dashboardExtension` that conforms to this shape.

```typescript
type DashboardExtension = {
  name: string;

  pages?: Array<{
    path: string;
    label: string;
    component: Component; // SolidJS component
  }>;

  actions?: Array<{
    label: string;
    match?: { jobType?: string | string[] };
    handler: (ctx: { jobId: string; client: Client }) => Promise<void>;
  }>;

  api?: (client: Client) => Array<{
    method: "GET" | "POST";
    path: string;
    handler: (req: Request) => Promise<Response>;
  }>;
};
```

Each module that wants dashboard integration exports a `dashboardExtension` conforming to this type:

```typescript
// Inside @queuert/state-postgres
const pgState = createPgStateModule(config);

pgState.maintenance.dashboardExtension = {
  name: "pg-maintenance",
  pages: [{ path: "/maintenance", label: "Maintenance", component: MaintenancePage }],
  actions: [
    {
      label: "Trigger Cleanup",
      match: { jobType: ["pg.cleanup", "pg.partition-create"] },
      handler: async ({ client }) => {
        await client.triggerCleanup();
      },
    },
  ],
  api: (client) => [
    {
      method: "GET",
      path: "/status",
      handler: async () => Response.json(await client.getMaintenanceStatus()),
    },
  ],
} satisfies DashboardExtension;
```

---

## Adapter Modules Reference

### @queuert/state-postgres

```typescript
const pgState = createPgStateModule({
  stateProvider: PgStateProvider<TxContext>,
  schema?: string,                    // default: "public"
});

await pgState.migrateToLatest();

pgState.clientAdapter                  // StateClientAdapter<PgTxContext, string>
pgState.workerAdapter                  // StateWorkerAdapter<PgTxContext, string>
pgState.maintenance.jobTypeRegistry    // cleanup + partition job types
pgState.maintenance.clientExtension    // methods + lifecycle: triggerCleanup(), onCreate
pgState.maintenance.jobTypeProcessorRegistry         // cleanup + partition processors
pgState.maintenance.dashboardExtension // maintenance status page
```

### @queuert/state-sqlite

```typescript
const sqliteState = createSqliteStateModule({
  stateProvider: SqliteStateProvider<TxContext>,
});

await sqliteState.migrateToLatest();

sqliteState.clientAdapter; // StateClientAdapter<SqliteTxContext, string>
sqliteState.workerAdapter; // StateWorkerAdapter<SqliteTxContext, string>
// No maintenance — SQLite doesn't need partitions or background cleanup
```

### queuert (in-process, core package)

```typescript
const inProcessState = createInProcessStateModule();
inProcessState.clientAdapter; // StateClientAdapter<InProcessContext, string>
inProcessState.workerAdapter; // StateWorkerAdapter<InProcessContext, string>

const inProcessNotify = createInProcessNotifyModule();
inProcessNotify.clientAdapter; // NotifyClientAdapter
inProcessNotify.workerAdapter; // NotifyWorkerAdapter
```

### @queuert/notify-redis

```typescript
const redisNotify = createRedisNotifyModule({
  provider: RedisNotifyProvider,
});

redisNotify.clientAdapter; // NotifyClientAdapter
redisNotify.workerAdapter; // NotifyWorkerAdapter
```

### @queuert/notify-postgres

```typescript
const pgNotify = createPgNotifyModule({
  provider: PgNotifyProvider,
});

pgNotify.clientAdapter; // NotifyClientAdapter
pgNotify.workerAdapter; // NotifyWorkerAdapter
```

### @queuert/otel

```typescript
const otel = createOtelModule({
  meter: Meter,
  tracer: Tracer,
});

otel.observabilityAdapter; // ObservabilityAdapter
// Not split — both client and worker emit through the same interface
```

---

## Design Decisions

### Explicit wiring over auto-extraction

Each integration point declares exactly what it receives. No `[helpersSymbol]` internals, no "pass plugin everywhere and framework figures it out." The cost is verbosity; the gain is that reading any `createClient` or `createInProcessWorker` call tells you the complete picture of what's wired.

### Singleton slots are structural, not validated

`stateAdapter` is a single required field on `createClient`, not an element in a plugins array. You can't accidentally pass two state adapters — the type system prevents it. Same for `notifyAdapter` and `observabilityAdapter`.

### Adapters split by consumer

The monolithic `StateAdapter` interface becomes `StateClientAdapter` + `StateWorkerAdapter`. This reflects reality: in horizontal scaling setups, each process creates its own adapter instances with independent connection pools. The split makes each consumer's needs explicit and allows the worker to operate independently of the client's adapter.

The underlying implementation may share a connection pool:

```typescript
// Inside @queuert/state-postgres
export function createPgStateModule(opts: { stateProvider; schema? }) {
  const shared = createSharedPgState(opts);
  return {
    clientAdapter: createPgStateClientAdapter(shared),
    workerAdapter: createPgStateWorkerAdapter(shared),
    maintenance: createPgMaintenanceExports(shared),
    migrateToLatest: () => shared.migrateToLatest(),
  };
}
```

### Modules bundle related concerns

`pgState.maintenance` groups cleanup + partition jobs, processors, client methods, and dashboard pages into a single namespace. They're not separable because they share internal implementation details and are always deployed together for Postgres.

Other state adapters (SQLite, in-process) don't have maintenance — the module simply doesn't export it.

### Dependencies are constructor injection

Cross-module dependencies are explicit function arguments, not runtime name-based lookups.

```typescript
// Stats module needs ephemeral storage — pass it in
const stats = createStatsModule({ ephemeralProvider: ephemeral });

// NOT: stats declares `dependencies: ["ephemeral"]` and hopes it's in the array
```

This gives compile-time safety, works across processes (each process wires its own), and makes the dependency graph readable from the wiring code.

### Open facets via convention

Modules export named properties for each integration point they target. The core package defines `clientExtension`, `handlerWrapper`, and processor slice shapes. `@queuert/dashboard` defines `dashboardExtension`. Future packages can define their own facet shapes without changing existing modules.

```typescript
// A module targeting a hypothetical @queuert/monitoring package:
const myModule = {
  clientAdapter: ...,
  monitoringExtension: { ... } satisfies MonitoringExtensionFacet,
};
```

---

## Open Questions

- Handler context type accumulation: `THandlerCtx1 & THandlerCtx2 & ...` — tuple-based mapped type vs builder pattern
- Should `observabilityAdapter` also split into client/worker interfaces, or is the unified interface sufficient given that event types are disjoint?
- State adapter split boundary: some operations (like `completeJob`, `createJobs`) are called by both client and worker — where do they live? Options: both interfaces include them (implemented via shared internal), or a third `StateSharedAdapter` that both extend.

---

## References

- **Temporal** — workers explicitly register which activities they handle; client only needs workflow types. Same package, different subsets on different processes.
- **tRPC** — `next({ ctx })` for type-safe context augmentation; `.pipe()`/`.concat()` for composition
- **Inngest** — lifecycle hooks (observable/wrapping/transform); `StaticTransform` mapped types
- **Elysia** — 7-generic type accumulation; 3-tier scope (local/scoped/global)
- **Prisma** — `$extends` with 4 components (client/model/query/result); chaining wrappers
- **Fastify** — scoped plugin registration with opt-in visibility
- **Django** — apps bundle models, views, admin, celery tasks; registered once in `INSTALLED_APPS`, each process extracts what it needs
