# Plugins

## Overview

Plugins extend Queuert by injecting job types into the client and job handlers into the worker. A plugin is a single object that participates in both construction phases — it extends the registry during client setup and extends processors during worker setup.

## Motivation

Some features require both a job type definition (schema, validation) and a corresponding processor (attempt handler). Examples: cleanup scheduling, recurring jobs, health checks. Without plugins, these features would require the user to manually define job types and wire up handlers, which is repetitive and error-prone.

Plugins encapsulate this: the user passes a plugin object, and queuert handles the wiring.

## Plugin Interface

A plugin provides two extension functions:

1. **`extendRegistry`** — receives the current registry and returns an extended one with the plugin's job types added
2. **`extendProcessors`** — receives the current processor map and returns an extended one with the plugin's handlers added

The `name` is used for diagnostics. Plugin job type names should be prefixed to avoid collisions with user-defined types (e.g., `queuert.cleanup.batch`).

## Usage

```typescript
const myPlugin = createMyPlugin({
  /* plugin-specific options */
});

const client = createClient({
  stateAdapter,
  registry,
  plugins: [myPlugin],
});

const worker = createInProcessWorker({
  client,
  processors: {
    /* user processors */
  },
  plugins: [myPlugin],
});
```

## Construction Behavior

### Client

During `createClient`, plugins are applied in array order. Each plugin's `extendRegistry` receives the registry returned by the previous plugin (or the user's base registry for the first plugin). The final extended registry is used for the client.

### Worker

During `createInProcessWorker`, plugins are applied in array order. Each plugin's `extendProcessors` receives the processor map returned by the previous plugin (or the user's base processors for the first plugin). The final extended processor map is used for the worker.

Both client and worker are unaware of plugins after construction — plugins only affect initialization.

## Design Decisions

**Extension functions, not declarative config.** Plugins receive the existing registry/processors and return extended versions. This is more flexible than a static bag of definitions: the plugin can inspect existing state, compose naturally with other plugins, and owns collision detection.

**Single object, not separate client/worker plugins.** A plugin is one thing the user passes to both `createClient` and `createInProcessWorker`. This avoids split configuration and ensures the job type definition always matches its processor.

**Plugins don't wrap or intercept.** They only add job types and processors. Cross-cutting concerns (logging, tracing) are handled by existing mechanisms (middlewares, observability adapter). Plugins are additive, not decorative.

**Plugins are passive after construction.** They don't hold references to the client or worker. They don't receive lifecycle callbacks.

## Considerations

- **Composition**: Multiple plugins compose via chaining: `plugin2.extendRegistry(plugin1.extendRegistry(base))`. Order follows array position.
- **Type safety**: Plugin job types extend the registry's type definitions. Plugin types are internal and not exposed to the user's `TJobTypeDefinitions` generic.
- **Async initialization**: If a plugin needs async setup (e.g., checking database state), the plugin factory itself is async — the plugin object passed to `createClient` is already initialized.

## See Also

- [Client](client.md) — Client construction and API
- [In-Process Worker](in-process-worker.md) — Worker construction and lifecycle
