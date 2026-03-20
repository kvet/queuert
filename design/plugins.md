# Plugin System Design

## Unified Plugin

A single plugin object carries optional facets. The system picks what it needs at each integration point.

```typescript
const myPlugin = definePlugin({
  name: "my-plugin",

  // Facet: job type definitions (optional)
  jobTypeRegistry: myJobTypeRegistry,

  // Facet: client (optional)
  client: {
    methods: (client) => ({
      performCleanup: async ({ transactionHooks, ...txCtx }) => {
        await client.startJobChain({ typeName: "cleanup.run", input: {}, transactionHooks, ...txCtx });
      },
    }),
    lifecycle: {
      onCreate: async ({ client, runInTransaction }) => {
        await runInTransaction(async ({ transactionHooks, ...txCtx }) => {
          await client.startJobChain({ typeName: "cleanup.run", input: {}, transactionHooks, ...txCtx });
        });
      },
    },
  },

  // Facet: worker handlers (optional)
  worker: {
    processors: (client) => createJobTypeProcessorRegistry({ ... }),
  },

  // Facet: handler wrapping (optional)
  handler: {
    wrapHandler: async ({ job, workerId, next }) => next({ logger: createLogger() }),
    wrapPrepare: async ({ job, next, ...txCtx }) => next({}),
    wrapComplete: async ({ job, transactionHooks, next, ...txCtx }) => next({ audit: createAudit() }),
  },
});
```

### User wiring

```typescript
// Plugin passed once to createClient — it extracts jobTypeRegistry + client methods
const client = await createClient({
  stateAdapter,
  jobTypeRegistry: appJobTypeRegistry,
  plugins: [myPlugin],
});

// Plugin passed once to createInProcessWorker — it extracts worker processors, handler wrapping, lifecycle hooks
// Worker auto-merges plugin processors with user processors, validates client has plugin installed
const worker = await createInProcessWorker({
  client,
  jobTypeProcessorRegistry: appProcessorRegistry,
  plugins: [myPlugin],
});
```

### What `createClient` does with the plugin

- Auto-merges `plugin.jobTypeRegistry` (if present) with the user's `jobTypeRegistry`
- Calls `plugin.client.methods(client)` and merges returned methods into client
- Tracks installed plugins via symbol for runtime validation

### What `createInProcessWorker` does with the plugin

- Validates client has the plugin installed (runtime check)
- Calls `plugin.worker.processors(client)` and merges with user's `jobTypeProcessorRegistry`
- Applies `plugin.handler` wrapping (onion model around all handlers)

### jobTypeRegistry ownership

Plugin exposes `jobTypeRegistry` at the top level. `createClient` auto-merges plugin registries with the user's `jobTypeRegistry` — the plugin is already declared in the `plugins` array, so extracting its registry is expected behavior, not hidden magic.

---

## Handler Wrapping (the `handler` facet)

Type-safe context injection via `next(ctx)` (tRPC-inspired).

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

**Migration:** Once implemented, remove `attemptMiddlewares` from `JobTypeProcessorDefaults`. `wrapHandler` fully subsumes it.

---

## Dashboard Facet

The `dashboard` facet is defined by `@queuert/dashboard`, not the core package. This is the primary example of open facets in action — the core's `definePlugin` knows nothing about it.

### How `createDashboard` consumes plugins

```typescript
const dashboard = createDashboard({
  client,
  plugins: [dlqPlugin, metricsPlugin], // extracts `dashboard` facet from each
});
```

`createDashboard` iterates plugins, looks for `plugin.dashboard`, and merges what it finds into the dashboard UI.

### Dashboard facet shape (defined by `@queuert/dashboard`)

```typescript
type DashboardPluginFacet = {
  // Custom pages added to the dashboard navigation
  pages?: Array<{
    path: string;
    label: string;
    component: Component; // SolidJS component
  }>;

  // Custom action buttons on job/chain detail views
  actions?: Array<{
    label: string;
    match?: { jobType?: string | string[] }; // which jobs show this action
    handler: (ctx: { jobId: string; client: Client }) => Promise<void>;
  }>;

  // Custom API routes mounted under /api/plugins/<plugin-name>/
  api?: (client: Client) => Array<{
    method: "GET" | "POST";
    path: string;
    handler: (req: Request) => Promise<Response>;
  }>;
};
```

### Example: DLQ plugin with dashboard facet

```typescript
const dlqPlugin = definePlugin({
  name: "dead-letter-queue",

  jobTypeRegistry: dlqJobTypeRegistry,

  client: {
    methods: (client) => ({
      getDlqEntries: async () => { ... },
    }),
  },

  worker: {
    processors: (client) => createJobTypeProcessorRegistry({ ... }),
  },

  handler: {
    wrapComplete: async ({ job, txCtx, transactionHooks, next }) => {
      try {
        return await next({});
      } catch (error) {
        // auto-enqueue to DLQ on failure
        ...
        throw error;
      }
    },
  },

  // Dashboard facet — @queuert/dashboard knows about this, core doesn't
  dashboard: {
    pages: [
      { path: "/dlq", label: "Dead Letters", component: DlqListPage },
      { path: "/dlq/:id", label: "DLQ Entry", component: DlqDetailPage },
    ],
    actions: [
      {
        label: "Retry",
        match: { jobType: "dlq.store-failed" },
        handler: async ({ jobId, client }) => {
          await client.startJobChain({ typeName: "dlq.retry", input: { originalJobId: jobId }, ... });
        },
      },
    ],
    api: (client) => [
      {
        method: "GET",
        path: "/stats",
        handler: async () => Response.json({ count: await client.getDlqEntries() }),
      },
    ],
  },
});
```

### How this demonstrates open facets

```
                    ┌─────────────────────────────────────┐
                    │         definePlugin({ ... })        │
                    │                                     │
                    │  name ─────── required by all       │
                    │  jobTypeRegistry ── core knows      │
                    │  client ────────── core knows       │
                    │  worker ────────── core knows       │
                    │  handler ──────── core knows        │
                    │  dashboard ────── @queuert/dashboard│
                    │  future-x ────── some-other-pkg     │
                    └─────────────────────────────────────┘

  core package:           looks for name, jobTypeRegistry, client, worker, handler
  @queuert/dashboard:     looks for dashboard
  hypothetical package:   looks for future-x
```

Each package defines and documents its own facet type. `definePlugin` doesn't need to import any of them — it just passes through whatever the plugin author provides.

---

## Design Decisions

### Open facets

`definePlugin` is a typed identity function — it doesn't enumerate all possible facets. Each integration point (`createClient`, `createInProcessWorker`, `createDashboard`) looks for its own key.

```typescript
const definePlugin = <T extends { name: string }>(plugin: T) => plugin;
```

Type safety comes from the consumer side: `createDashboard` accepts `plugins` and extracts `plugin.dashboard` with its own type assertion. Plugin authors get autocomplete if they import the facet type from the relevant package:

```typescript
import type { DashboardPluginFacet } from "@queuert/dashboard";

const myPlugin = definePlugin({
  name: "my-plugin",
  dashboard: { ... } satisfies DashboardPluginFacet,
});
```

## Plugin Dependencies

Plugins can declare dependencies on other plugins. Resolved loosely by plugin name at runtime.

```typescript
const dlqPlugin = definePlugin({
  name: "dead-letter-queue",
  jobTypeRegistry: dlqJobTypeRegistry,
  client: {
    methods: (client) => ({
      getDlqEntries: async () => { ... },
    }),
  },
  worker: {
    processors: (client) => createJobTypeProcessorRegistry({ ... }),
  },
});

const dlqDashboardPlugin = definePlugin({
  name: "dlq-dashboard",
  // Declares dependency — resolved by name at runtime
  dependencies: ["dead-letter-queue"],
  dashboard: {
    pages: [
      { path: "/dlq", label: "Dead Letters", component: DlqListPage },
    ],
    api: (client, pluginContext) => [
      {
        method: "POST",
        path: "/retry",
        handler: async (req) => {
          const dlq = pluginContext.getPlugin("dead-letter-queue");
          // Access DLQ client methods via the plugin
          ...
        },
      },
    ],
  },
});
```

### Resolution

Each integration point (`createClient`, `createInProcessWorker`, `createDashboard`) receives the full `plugins` array. When processing a plugin with `dependencies`, it checks that all named dependencies are present in the array. If missing, throws:

```
Error: Plugin "dlq-dashboard" requires plugin "dead-letter-queue" — add it to the plugins array.
```

### Cross-plugin communication via `pluginContext`

Plugins with dependencies access other plugins through a `pluginContext` passed to their facet functions. Type safety comes from casting with a type exported by the dependency package:

```typescript
import type { DlqPlugin } from "@queuert/dlq";
const dlq = pluginContext.getPlugin("dead-letter-queue") as DlqPlugin;
```

### Why loose coupling by name (not symbol)

- Plugins are separate packages — they can't share a symbol without a shared dependency
- Name-based lookup is simple, debuggable, and works across package boundaries
- Type safety is opt-in via the dependency package's exported types

## Open Questions

- Multiple plugin type accumulation: `THandlerCtx1 & THandlerCtx2 & ...` — tuple-based mapped type vs builder pattern

---

## References

- **tRPC** — `next({ ctx })` for type-safe context augmentation; `.pipe()`/`.concat()` for composition
- **Inngest** — lifecycle hooks (observable/wrapping/transform); `StaticTransform` mapped types
- **Elysia** — 7-generic type accumulation; 3-tier scope (local/scoped/global)
- **Prisma** — `$extends` with 4 components (client/model/query/result); chaining wrappers
- **Fastify** — scoped plugin registration with opt-in visibility
