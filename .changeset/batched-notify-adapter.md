---
"queuert": major
"@queuert/postgres": major
"@queuert/redis": major
"@queuert/nats": major
---

The notify adapter publishes in batches and drops the wake budget. A commit that schedules several job types, completes several chains or loses several attempts, and a worker that reclaims a batch of expired attempts, pay one round-trip per method instead of one per item: one `EVAL` on Redis, one `pg_notify` statement on PostgreSQL, one flush on NATS. Every idle worker listening for a type wakes on its job-scheduled notification and the database's batch acquisition settles which worker gets each job, as the PostgreSQL adapter already did. Listeners still receive one notification per type, chain or job, and a batch that fails to publish loses all of its notifications, which are hints that workers recover from by polling. Custom notify adapters and providers must be updated.

- `NotifyAdapter`: `notifyJobScheduled(typeName)` is replaced by `notifyJobsScheduled(typeNames)`, `notifyChainCompleted(chainId)` by `notifyChainsCompleted(chainIds)`, and `notifyJobAttemptLost(jobId)` by `notifyJobAttemptsLost(jobIds)`. Batches are never empty, and items in a batch are expected to be unique. The `listen*` methods are unchanged.
- `NotifyAdapter.provideWakeHint` and `NotifyAdapter.consumeWakeHint` are removed.
- A worker that reclaims expired attempts no longer publishes job-scheduled notifications for them; it acquires the released jobs itself.
- `createNatsNotifyAdapter` no longer accepts `kv`; the JetStream KV bucket is no longer used.
- `PgNotifyProvider.publish` takes `messages: string[]` and publishes them in one statement, e.g. `SELECT pg_notify($1, message) FROM unnest($2::text[]) AS message`.
- `RedisNotifyProvider.publish` is removed; the Redis adapter publishes from a Lua script through `eval`.
- Redis hint keys (`<prefix>:hint:<typeName>`) and NATS KV hint entries are no longer written. During a rolling upgrade, older publishers still write them and older workers still read them: an older worker that finds a budget already claimed skips the wake and picks the job up on its next poll, until the entries expire within 60 seconds. Older workers that find no entry wake on every notification.
- The `operation` reported by `notify_adapter_error` logs and the `queuert.adapter.operation` attribute of the `queuert.notify_adapter.error` metric use the new method names.
