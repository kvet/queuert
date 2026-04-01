# Handler Wrapping

Type-safe context injection via `next(ctx)` (tRPC-inspired). `handlerWrappers` array on `createInProcessWorker` and `createJobTypeProcessorRegistry`.

```typescript
type HandlerWrapper<
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

## Wrapping phases

The three wrap hooks correspond to the three phases of job processing:

- **`wrapHandler`** — wraps the entire attempt handler execution. Receives job + workerId. Use for: logging, tracing spans, error boundaries, timeout enforcement.
- **`wrapPrepare`** — wraps the prepare phase (within transaction). Receives job + transaction context. Use for: injecting transactional resources, pre-flight checks.
- **`wrapComplete`** — wraps the complete phase (within transaction). Receives job + transaction context + transactionHooks. Use for: audit trails, side-effect buffering, post-completion hooks.

Each wrap is optional — implement only the phases your wrapper needs.

## Two registration scopes

1. **Worker-level** — wrapper passed to `createInProcessWorker`'s `handlerWrappers`. Applied to ALL handlers. Every `JobTypeProcessorRegistry` passed to this worker must be created expecting this wrapper's context. Enforced at compile time. Outer onion layer.
2. **Registry-level** — wrapper passed to `createJobTypeProcessorRegistry`. Only that registry's handlers receive the context. Inner onion layer.

```
Execution: worker wrapper 1 → worker wrapper 2 → registry wrapper 1 → registry wrapper 2 → handler
```

## Example: Audit trail with handler wrapping

```typescript
const auditWrapper: HandlerWrapper<{}, {}, { audit: AuditTrail }> = {
  wrapComplete: async ({ job, next }) => next({ audit: createAuditTrail(job) }),
};

const worker = await createInProcessWorker({
  client,
  jobTypeProcessorRegistry: appProcessors,
  handlerWrappers: [auditWrapper],
});
```

## Migration from attemptMiddlewares

The current `attemptMiddlewares` in `JobTypeProcessorDefaults` wraps the entire attempt as a single `(context, next) => next()` layer. The new `wrapHandler` is a direct replacement:

| Current (`attemptMiddlewares`) | New (`handlerWrappers`)                                                          |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `(ctx, next) => next()`        | `wrapHandler: ({ job, workerId, next }) => next({})`                             |
| Wraps entire attempt           | `wrapHandler` wraps entire attempt; `wrapPrepare`/`wrapComplete` wrap sub-phases |
| No context injection           | `next(ctx)` injects typed context into handler                                   |
| One scope (worker defaults)    | Two scopes (worker-level, registry-level)                                        |

Once implemented, remove `attemptMiddlewares` from `JobTypeProcessorDefaults`. `wrapHandler` fully subsumes it.
