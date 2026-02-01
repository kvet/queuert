# Publish Readiness Report

Generated: 2026-02-01

## Executive Summary

The Queuert library is **ready for publish** with minor documentation updates recommended. All core functionality is implemented correctly, exports are properly configured, and tests pass. The main areas requiring attention are documentation synchronization issues and a few missing examples.

## Overall Status

| Category                    | Status | Critical Issues | Warnings | Suggestions |
| --------------------------- | ------ | --------------- | -------- | ----------- |
| Documentation Coherence     | ⚠️     | 2               | 4        | 2           |
| API Design                  | ✅     | 0               | 5        | 4           |
| Implementation Verification | ✅     | 0               | 1        | 1           |
| Feature Completeness        | ✅     | 0               | 5        | 2           |
| API Consistency             | ✅     | 0               | 5        | 4           |

---

## Critical Issues

### 1. worker.md says `log` is required but it's now optional

**File:** `docs/design/worker.md:335`

**Issue:** The comment says `log, // Required: logger` but recent commit `fac5aac` made the `log` parameter optional with a no-op default.

**Why it matters:** Documentation contradicts the actual API, could confuse developers.

**Fix:** Change the comment to `// Optional: logger (default: silent)`

### 2. Main README examples include `log` parameter without explaining it's optional

**File:** `README.md` (lines 48, 75, 407, 470, 669, 739, 765, 792)

**Issue:** All code examples include `log: createConsoleLog()` but don't mention that logging is optional and silent by default.

**Why it matters:** Users may think `log` is required when it's not.

**Fix:** Add a note near the first example or in a "Logging" section explaining that `log` is optional (defaults to silent operation).

---

## Warnings

### Documentation

| Issue                        | Location                          | Description                                                                                          | Suggested Fix           |
| ---------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------- |
| Missing testing exports docs | `packages/otel/README.md`         | OTEL package exports `extendWithObservabilityOtel` from `./testing` but README doesn't document this | Add Testing section     |
| Missing testing exports docs | `packages/core/README.md`         | Core package has `./testing` entry point but README doesn't mention it                               | Add Testing section     |
| Undocumented fields          | `docs/design/adapters.md:202-204` | `originId` and `rootChainId` in StateJob interface aren't explained                                  | Add explanation         |
| Generic params mismatch      | `docs/design/adapters.md:86`      | Shows `StateAdapter<TTxContext, TContext, TJobId>` (3 params) but code has 2                         | Update to show 2 params |

### API Design

| Issue                           | Location                                                                   | Description                                                   | Impact                        |
| ------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------- |
| Async factory with no I/O       | `packages/otel/src/observability-adapter/observability-adapter.otel.ts:10` | `createOtelObservabilityAdapter` is async but performs no I/O | Minor - unnecessary await     |
| Duplicate type definition       | `packages/core/src/entities/job-type.ts:4` vs `job-type-registry.ts:8`     | `JobTypeReference` defined differently in two places          | Type confusion possible       |
| Inconsistent error constructors | `packages/core/src/errors.ts`                                              | Some errors use `cause` casting, others use explicit options  | Minor - inconsistent patterns |
| Loose generic constraints       | `packages/core/src/client.ts:29`                                           | Uses `StateAdapter<any, any>` losing type information         | Reduced type safety           |
| Extra provider parameter        | `packages/sqlite/src/state-provider/state-provider.sqlite.ts:30`           | SQLite has extra `returns: boolean` parameter vs Postgres     | API inconsistency             |

### Feature Completeness

| Issue                            | Location                     | Description                                           | Effort           |
| -------------------------------- | ---------------------------- | ----------------------------------------------------- | ---------------- |
| Missing README                   | `examples/log-console/`      | log-console example is missing README.md              | Trivial          |
| Missing example                  | `examples/`                  | No `notify-nats-*` example exists for `@queuert/nats` | Small            |
| Tracing spans not implemented    | `packages/otel/`             | Listed in TODO.md but not implemented                 | Medium           |
| SQLite concurrency tests skipped | `packages/sqlite/src/specs/` | Uses `skipConcurrencyTests: true`                     | Known limitation |
| MongoDB migration tracking       | `packages/mongodb/`          | Doesn't track migration versions like PG/SQLite       | Small            |

### API Consistency

| Issue                  | Location                                              | Description                                            | Notes                       |
| ---------------------- | ----------------------------------------------------- | ------------------------------------------------------ | --------------------------- |
| Prefix naming          | NATS uses `subjectPrefix`, others use `channelPrefix` | Follows technology terminology                         | Intentional                 |
| Missing provider type  | `@queuert/nats`                                       | No `NatsNotifyProvider` type exported                  | Uses raw NatsConnection     |
| Migration return type  | `@queuert/mongodb`                                    | `migrateToLatest` returns `void` not `MigrationResult` | Different from SQL adapters |
| ID generation patterns | State adapters                                        | Postgres uses `idDefault`, others use `idGenerator`    | Server vs client-side       |
| AsyncLock re-export    | `@queuert/sqlite`                                     | Re-exports from `queuert/internal` without explanation | Should document why         |

---

## Suggestions

### Documentation

- Add "Logging" section to main README explaining silent default
- Document terminology differences (blocker vs dependency usage)

### Feature Completeness

- Add multi-worker test (TODO in `chains.test-suite.ts:700`)
- Add multi-worker example (mentioned in `TODO.md`)

### API Design

- Export `RescheduleJobError` from core index
- Add `code` property to all error classes for programmatic handling
- Consider exporting provider types from all packages

### API Consistency

- Consider `NatsNotifyProvider` type alias for consistency
- Document AsyncLock re-export rationale

---

## Verification Results

### Export Audit

| Package           | Documented         | Actual             | Status                  |
| ----------------- | ------------------ | ------------------ | ----------------------- |
| queuert           | 36 exports         | 36 exports         | ✅ Complete             |
| @queuert/postgres | 6 main + 2 testing | 6 main + 2 testing | ✅ Complete             |
| @queuert/sqlite   | 6 main + 1 testing | 6 main + 1 testing | ✅ Complete             |
| @queuert/mongodb  | 3 main + 1 testing | 3 main + 1 testing | ✅ Complete             |
| @queuert/redis    | 2 main + 1 testing | 2 main + 1 testing | ✅ Complete             |
| @queuert/nats     | 2 main + 1 testing | 2 main + 1 testing | ✅ Complete             |
| @queuert/otel     | 1 main             | 1 main + 1 testing | ⚠️ Testing undocumented |

### Interface Compliance

All documented interfaces are fully implemented:

- ✅ JobTypeRegistry (5 methods + $definitions)
- ✅ StateAdapter (18 methods)
- ✅ NotifyAdapter (6 methods)
- ✅ ObservabilityAdapter (22 methods)

### Test Coverage

| Test Suite       | Status  | Notes                                     |
| ---------------- | ------- | ----------------------------------------- |
| Core test suites | ✅ Pass | 13 test suite files                       |
| Postgres specs   | ✅ Pass | State + Notify                            |
| SQLite specs     | ✅ Pass | 2 concurrency tests conditionally skipped |
| MongoDB specs    | ✅ Pass | State only                                |
| Redis specs      | ✅ Pass | Notify only                               |
| NATS specs       | ✅ Pass | Notify only                               |
| OTEL specs       | ✅ Pass | Observability                             |

### Example Status

| Category            | Complete        | Missing                    |
| ------------------- | --------------- | -------------------------- |
| Validation (4)      | ✅ All complete | -                          |
| Log (3)             | ⚠️ 2 complete   | log-console missing README |
| Observability (1)   | ✅ Complete     | -                          |
| State Postgres (5)  | ✅ All complete | -                          |
| State SQLite (5)    | ✅ All complete | -                          |
| State MongoDB (2)   | ✅ All complete | -                          |
| Notify Postgres (2) | ✅ All complete | -                          |
| Notify Redis (2)    | ✅ All complete | -                          |
| Notify NATS         | ❌ Missing      | No example exists          |
| Showcase (7)        | ✅ All complete | -                          |
| Benchmark (1)       | ✅ Complete     | -                          |

---

## Recommended Actions Before Publish

### Must Fix (Critical)

1. Update `docs/design/worker.md:335` - Change `log` comment from "Required" to "Optional"
2. Add logging note to main `README.md` explaining optional log parameter

### Should Fix (Warnings)

1. Add README.md to `examples/log-console/`
2. Add Testing section to `packages/otel/README.md`
3. Update `docs/design/adapters.md:86` - Fix StateAdapter generic parameter count

### Nice to Have (Suggestions)

1. Create `notify-nats-*` example
2. Add Testing section to `packages/core/README.md`
3. Document `originId` and `rootChainId` in adapters design doc

---

## Conclusion

The Queuert library demonstrates solid implementation quality with comprehensive test coverage and consistent API design. The main issues are documentation synchronization problems that arose from the recent `log` parameter change. After addressing the critical documentation issues, the library is ready for publish.
