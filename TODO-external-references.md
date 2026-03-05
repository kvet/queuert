# External type references in `defineJobTypes` / `createJobTypeRegistry`

## Problem

`defineJobTypes<T>()` and `createJobTypeRegistry<T>()` validate `continueWith` and `blockers` references against `T` only. Cross-slice references are impossible — if an orders slice wants to use a notification type as a blocker, it must duplicate the notification definition inside its own `defineJobTypes` call.

## Desired API

Add an optional second type parameter `TExternal` for types that are referenced but not owned:

```ts
const orderJobTypes = defineJobTypes<
  {
    "orders.create-order": {
      entry: true;
      input: { userId: string; items: Item[] };
      continueWith: { typeName: "orders.fulfill-order" };
    };
    "orders.fulfill-order": {
      input: { orderId: number };
      output: { orderId: number; fulfilledAt: string };
      blockers: [{ typeName: "notifications.send-notification" }];
    };
  },
  // External types — available for reference validation, not owned by this slice
  JobTypeRegistryDefinitions<typeof notificationJobTypes>
>();
```

- `T` = owned definitions (these become the registry's phantom type)
- `TExternal` = read-only reference context (defaults to `Record<never, never>`)
- Validation checks references against `T & TExternal`
- The registry's phantom type remains `T` only (not `T & TExternal`)

## Files to modify

### Core type changes

1. **`packages/core/src/entities/job-type.validation.ts`** — The key file. `ValidatedJobTypeDefinitions<T>` currently validates against `T` only. Add a second param:
   - `ValidatedJobTypeDefinitions<T, TExternal = Record<never, never>>`
   - `ValidateJobType` passes `T & TExternal` to `ValidateReference` and `ValidateBlockers` instead of just `T`
   - `EntryTypeKeys` computes over `T & TExternal` for blocker entry-point validation
   - `continueWith` valid keys become `keyof (T & TExternal) & string` instead of `keyof T & string`

2. **`packages/core/src/entities/job-type.ts`** — Update `defineJobTypes` signature:

   ```ts
   export const defineJobTypes = <
     T extends BaseJobTypeDefinitions & ValidatedJobTypeDefinitions<T, TExternal>,
     TExternal extends BaseJobTypeDefinitions = Record<never, never>,
   >(): JobTypeRegistry<T> => { ... };
   ```

3. **`packages/core/src/entities/job-type-registry.ts`** — Update `createJobTypeRegistry` signature to accept `TExternal` for validation adapters that also want cross-slice references:
   ```ts
   export const createJobTypeRegistry = <
     TJobTypeDefinitions,
     TExternal extends BaseJobTypeDefinitions = Record<never, never>,
   >(config: JobTypeRegistryConfig): JobTypeRegistry<TJobTypeDefinitions> => { ... };
   ```
   (Runtime behavior doesn't change — `TExternal` is compile-time only.)

### Tests

4. **`packages/core/src/entities/job-type.spec.ts`** — Add tests for:
   - `defineJobTypes` with external nominal `continueWith` reference
   - `defineJobTypes` with external nominal `blockers` reference
   - `defineJobTypes` with external structural `blockers` reference
   - Compile-time error when external reference doesn't match any external type
   - Phantom type only includes `T`, not `TExternal`

5. **`packages/core/src/entities/merge-job-type-registries.spec.ts`** — Add test showing cross-slice references work end-to-end after merging

### Example update

6. **`examples/showcase-slices/`** — Update the fulfillment slice to use external references instead of duplicating types. The orders slice can reference `notifications.send-notification` directly. Remove `slice-fulfillment-definitions.ts` and `slice-fulfillment-processors.ts` (no longer needed).

### Documentation

7. **`docs/src/content/docs/guides/slices.md`** — Document external references pattern
8. **`docs/src/content/docs/reference/queuert/types.md`** — Update `defineJobTypes` and `createJobTypeRegistry` signatures

## Key constraints

- `TExternal` defaults to `Record<never, never>` so existing code is unaffected (zero breaking changes)
- Navigation types in `job-type.navigation.ts` don't need changes — they resolve against the full merged `TJobTypeDefinitions` at point of use (client/worker level), not slice-level definitions
- The `satisfies InProcessWorkerProcessors<SA, Defs>` pattern in processors uses merged definitions from the worker, so blocker chain types resolve correctly at the processor level too
- Runtime behavior is unchanged — this is purely a compile-time validation relaxation
