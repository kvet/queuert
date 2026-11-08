---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/redis": major
"@queuert/nats": major
"@queuert/otel": major
"@queuert/dashboard": major
---

Every factory now returns its value synchronously instead of a promise, so a client, worker runner or adapter can be built at module top level or in a non-async context. `await` on the result keeps working.

- Synchronous: `createClient`, `createWorkerRunner`, `createInProcessStateAdapter`, `createPgStateAdapter`, `createPgNotifyAdapter`, `createSqliteStateAdapter`, `createRedisNotifyAdapter`, `createNatsNotifyAdapter`, `createOtelObservabilityAdapter` and `createDashboard`.
- Construction-time validation errors (invalid worker runner options, `InvalidWorkerIdError`, `DuplicateJobTypeError`, missing `requiredAttemptMiddleware`, invalid `schema`, `tablePrefix`, `jobIdType` or `workerIdType`) throw instead of rejecting.
- `createX(...).then((x) => ...)` becomes `const x = createX(...)`, and `createX(...).catch(...)` becomes a `try` / `catch` around the call.
- A `Promise<Client>` (or other `Promise<...>`) annotation on a factory result becomes `Client`, and `Awaited<ReturnType<typeof createX>>` can be simplified to `ReturnType<typeof createX>`.
