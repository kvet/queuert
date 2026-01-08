# Queuert Public API Review

## Executive Summary

Queuert has a **well-designed, thoughtful API** overall. The type system is impressive, with strong compile-time guarantees around job continuation flows, blocker dependencies, and input/output matching. However, there are several issues ranging from minor inconsistencies to more significant usability concerns.

---

## Issues (Ranked by Severity)

### SEVERE

#### 1. `createQueuert` is async but doesn't need to be

**Location:** `packages/core/src/index.ts:167`

```typescript
export const createQueuert = async <...>({...}): Promise<Queuert<...>> => {
```

The function body contains no `await` calls - it's purely synchronous setup. Making it `async` forces users to await unnecessarily and creates confusion about whether initialization involves I/O.

**Impact:** API ergonomics, potential performance overhead, misleading signature.

---

#### 2. Inconsistent async factory signatures across adapters

**Location:** Multiple packages

| Factory | Returns |
|---------|---------|
| `createQueuert` | `Promise<Queuert>` (but doesn't need to be) |
| `createPgStateAdapter` | `StateAdapter` (sync) |
| `createSqliteStateAdapter` | `StateAdapter` (sync) |
| `createPgNotifyAdapter` | `Promise<NotifyAdapter>` (async) |
| `createRedisNotifyAdapter` | `Promise<NotifyAdapter>` (async) |
| `createInProcessStateAdapter` | `StateAdapter` (sync) |
| `createInProcessNotifyAdapter` | `NotifyAdapter` (sync) |
| `createNoopNotifyAdapter` | `NotifyAdapter` (sync) |

This inconsistency makes it hard to reason about which factories need `await`.

**Impact:** Confusing developer experience, easy to make mistakes.

---

#### 3. `jobTypeDefinitions` parameter is required but only used for type inference

**Location:** `packages/core/src/index.ts:177`

```typescript
export const createQueuert = async <...>({
  stateAdapter,
  notifyAdapter,
  jobTypeDefinitions, // Required but never used at runtime!
  log,
}: {
  stateAdapter: TStateAdapter;
  notifyAdapter?: NotifyAdapter;
  jobTypeDefinitions: TJobTypeDefinitions; // <-- This is only for TypeScript
  log: Log;
})
```

The `jobTypeDefinitions` parameter exists solely to capture the type but is never used at runtime. This is a code smell - the value is discarded but users must provide it.

**Impact:** Confusing API design, wasted parameter.

**Suggestion:** Use a phantom type pattern or make this optional with a type-only approach like:
```typescript
createQueuert<MyJobTypes>()({ stateAdapter, log })
```

---

### MODERATE

#### 4. Inconsistent naming: `typeName` vs `name` for job type registration

**Location:** `packages/core/src/index.ts:72-73`

```typescript
implementJobType: <TJobTypeName extends keyof TJobTypeDefinitions & string>(options: {
  name: TJobTypeName; // Here it's "name"
  ...
```

But in `startJobSequence`:
```typescript
startJobSequence: (...options: {
  typeName: TSequenceTypeName; // Here it's "typeName"
  ...
```

This inconsistency (`name` in `implementJobType` vs `typeName` everywhere else) is confusing.

**Impact:** Cognitive load, potential typos.

---

#### 5. `waitForJobSequenceCompletion` requires spreading both sequence properties and options

**Location:** Tests show this pattern repeatedly:

```typescript
await queuert.waitForJobSequenceCompletion({
  ...jobSequence, // spread id, typeName
  ...completionOptions, // spread pollIntervalMs, timeoutMs
});
```

Users must destructure/spread two objects. A cleaner API would be:
```typescript
await queuert.waitForJobSequenceCompletion(jobSequence, {
  pollIntervalMs: 100,
  timeoutMs: 5000,
});
```

**Impact:** Verbose, error-prone usage pattern.

---

#### 6. Provider interfaces have inconsistent return types

**Location:** Multiple provider files

`PgStateProvider`:
```typescript
provideContext: (fn: (context: TContext) => Promise<unknown>) => Promise<unknown>;
// Returns unknown
```

`RedisNotifyProvider`:
```typescript
provideContext: <T>(type: ..., fn: (context: TContext) => Promise<T>) => Promise<T>;
// Returns T (generic)
```

`SqliteStateProvider`:
```typescript
provideContext: (fn: (context: TContext) => Promise<unknown>) => Promise<unknown>;
// Returns unknown
```

The Redis provider has better typing with a generic return type.

**Impact:** Inconsistent type safety across adapters.

---

#### 7. `deleteJobSequences` takes `sequenceIds` but the parameter name is inconsistent with other methods

**Location:** `packages/core/src/index.ts:121-124`

```typescript
deleteJobSequences: (
  options: {
    sequenceIds: GetStateAdapterJobId<TStateAdapter>[]; // plural
  } & GetStateAdapterContext<TStateAdapter>,
) => Promise<void>;
```

But `getJobSequence` uses singular:
```typescript
getJobSequence: (options: {
  typeName: TSequenceTypeName;
  id: GetStateAdapterJobId<TStateAdapter>; // singular
```

**Impact:** Minor inconsistency, but `rootSequenceIds` might be clearer since these must be root sequences.

---

#### 8. `$idType` phantom type parameter is marked deprecated

**Location:** `packages/postgres/src/state-adapter/state-adapter.pg.ts:91-92`

```typescript
/** @deprecated used for type inference only */
$idType?: TIdType;
```

Deprecating something used for type inference is confusing. If it's the intended pattern, it shouldn't be deprecated. If there's a better way, the better way should be documented.

**Impact:** Confusing documentation.

---

### LOW

#### 9. `withNotify` has an unusual signature with rest args

**Location:** `packages/core/src/index.ts:148-151`

```typescript
withNotify: <T, TArgs extends any[]>(
  cb: (...args: TArgs) => Promise<T>,
  ...args: TArgs
) => Promise<T>;
```

But it's used like:
```typescript
queuert.withNotify(async () => runInTransaction(...))
```

The rest args capability is unused in practice. A simpler signature would be:
```typescript
withNotify: <T>(cb: () => Promise<T>) => Promise<T>;
```

**Impact:** Over-engineered signature.

---

#### 10. Missing `RescheduleJobError` export

**Location:** `packages/core/src/index.ts`

The `rescheduleJob` function is exported, but `RescheduleJobError` (which it throws) is not exported from the main entry point. Users can't type-check for this error.

**Impact:** Incomplete error handling API.

---

#### 11. `NotifyAdapter` doesn't use generic job ID type

**Location:** `packages/core/src/notify-adapter/notify-adapter.ts`

```typescript
export type NotifyAdapter = {
  notifyJobScheduled: (typeName: string, count: number) => Promise<void>;
  listenJobScheduled: (typeNames: string[], onNotification: (typeName: string) => void) => Promise<...>;
  notifyJobSequenceCompleted: (sequenceId: string) => Promise<void>; // Always string!
  ...
};
```

The `StateAdapter` uses `TJobId` generics, but `NotifyAdapter` hardcodes `string`. This means the APIs are misaligned when using custom ID types.

**Impact:** Type inconsistency.

---

#### 12. No way to get the current job from within a process function without it being in scope

**Location:** Process function API

The job is passed once at the top of the process function. If a user has a deeply nested helper function, they need to pass the job through manually. There's no `getCurrentJob()` accessor pattern.

**Impact:** Minor ergonomics issue.

---

#### 13. `leaseConfig` and `retryConfig` are optional at multiple levels with different defaults

**Location:** `packages/core/src/worker/executor.ts` and `implementJobType`

Defaults exist at:
- Worker start options (`defaultLeaseConfig`, `defaultRetryConfig`)
- Per-job-type options (`leaseConfig`, `retryConfig`)

This is fine, but the relationship isn't documented in types.

**Impact:** Configuration confusion potential.

---

#### 14. `signal.reason` types aren't exported

**Location:** `packages/core/src/worker/job-process.ts:137`

```typescript
signal: TypedAbortSignal<"taken_by_another_worker" | "error" | "not_found" | "already_completed">;
```

The `TypedAbortSignal` type is not exported, so users can't properly type-check the abort reason.

**Impact:** Incomplete type exports.

---

#### 15. `createNoopNotifyAdapter` is exported but not documented

**Location:** The core package exports it, but README doesn't mention it.

**Impact:** Undocumented feature.

---

## Suggestions (Not Issues)

### 1. Consider a builder pattern for `createQueuert`

Instead of:
```typescript
const queuert = await createQueuert({
  stateAdapter,
  notifyAdapter,
  jobTypeDefinitions: defineUnionJobTypes<{...}>(),
  log,
});
```

Consider:
```typescript
const queuert = createQueuert<MyJobTypes>()
  .withStateAdapter(stateAdapter)
  .withNotifyAdapter(notifyAdapter)
  .withLog(log)
  .build();
```

This would eliminate the phantom `jobTypeDefinitions` parameter.

---

### 2. `Log` type could be more useful

The `Log` function type is powerful for structured logging, but users might appreciate a default console logger:
```typescript
import { createConsoleLog } from 'queuert';
```

---

### 3. Consider exporting `GetStateAdapterContext`

This type is used in the API but is exported somewhat buried. Users implementing custom providers might want easier access.

---

## What's Done Well

1. **Type safety**: The `DefineContinuationInput`, `DefineContinuationOutput`, and `DefineBlocker` marker types provide excellent compile-time guarantees.

2. **Consistent entity lifecycle**: Job and JobSequence both use `blocked -> pending -> running -> completed` with consistent naming.

3. **Flexible processing modes**: The `prepare`/`complete` pattern with atomic vs staged modes is well-designed.

4. **Provider abstraction**: The separation of StateAdapter/StateProvider and NotifyAdapter/NotifyProvider allows users to bring their own ORM/database clients.

5. **Comprehensive test suites**: The reusable test suite pattern ensures consistent behavior across adapters.

6. **Clear documentation in CLAUDE.md**: The naming conventions and design philosophy are well-documented.

7. **Good error class hierarchy**: `JobNotFoundError`, `JobTakenByAnotherWorkerError`, etc. are properly typed.

8. **Thoughtful retry/lease configuration**: Exponential backoff with configurable parameters.

---

## Summary Table

| Severity | Count | Key Issues |
|----------|-------|------------|
| Severe | 3 | Unnecessary async, inconsistent factory signatures, phantom parameter |
| Moderate | 5 | `name` vs `typeName`, awkward `waitFor` API, provider typing |
| Low | 7 | Missing exports, minor inconsistencies |

---

## Conclusion

The API is **production-ready** but would benefit from addressing the severe issues before a major version bump. The type system is genuinely impressive and the core abstractions are sound.
