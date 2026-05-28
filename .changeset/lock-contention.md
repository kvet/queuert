---
"queuert": minor
"@queuert/postgres": minor
"@queuert/sqlite": minor
---

Stricter batch errors for `client.triggerJobs`, and breaking state-provider SPI changes for custom provider authors.

- New batch error variants: `JobsNotFoundError` and `JobsNotTriggerableError`, thrown by `client.triggerJobs` when one or more inputs are missing or not pending. Validation is atomic — no job is triggered on failure. `client.triggerJob` continues to throw the singular `JobNotFoundError` / `JobNotTriggerableError`.
- The `status` property has been removed from `JobNotTriggerableError`. If you read `error.status` in a `catch`, switch to checking the job's status yourself; the batch `JobsNotTriggerableError` exposes the offending ids via `jobIds`.
- `StateProvider` (both `@queuert/postgres` and `@queuert/sqlite`) gains a required `transactionConcurrency: "concurrent" | "serialized"` field that reports whether two `withTransaction` callbacks can run in flight at once. Custom providers must declare it — use `"concurrent"` for connection-pool backed providers (pg, postgres-js, Drizzle, Kysely, Prisma over pg) and `"serialized"` for single-handle SQLite drivers. The field is forwarded to `StateAdapter.transactionConcurrency`.
