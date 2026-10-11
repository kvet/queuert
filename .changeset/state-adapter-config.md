---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

State adapters now expose their configuration as `stateAdapter.config`, and core uses it to generate and validate job IDs and enforce the blocker limit before anything is written. The per-job blocker limit and the per-status count cap are no longer hardcoded, and `transactionConcurrency` moves out of the adapter contract into the conformance fixture, since nothing at runtime used it. Defaults are unchanged, so existing setups behave the same.

- New `maxBlockersPerJob` (default `100`) and `countCap` (default `10_000`) options on `createPgStateAdapter`, `createSqliteStateAdapter`, and `createInProcessStateAdapter`; non-positive or non-integer values throw at creation.
- `StateAdapter` gains a required `config: StateAdapterConfig` (`generateId`, `validateId`, `maxBlockersPerJob`, `countCap`), exported from `queuert`; custom state adapters must provide it.
- `validateId` now runs in core on caller-supplied and generated IDs, throwing `InvalidJobIdError` before any write; `id` is now required on every job passed to `StateAdapter.createJobs` and `continueJobs`, and adapters no longer generate or validate IDs.
- Removed `transactionConcurrency` from `StateAdapter`, `PgStateProvider`, and `SqliteStateProvider`; delete it from custom providers and adapters.
- `runStateAdapterConformance` fixtures now require `transactionConcurrency: "concurrent" | "serialized"` (`"serialized"` skips the concurrent-transaction cases) and no longer take `generateId` or `generateInvalidId`.
