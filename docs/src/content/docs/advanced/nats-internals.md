---
title: NATS Internals
description: Pub/sub subjects, JetStream KV hints, and revision-based CAS in the NATS notify adapter.
sidebar:
  order: 10
---

## Overview

This document describes the internal implementation of `@queuert/nats`. Like Redis, NATS is used exclusively as a **notification adapter** — it does not store job state. NATS provides pub/sub notifications with an optional JetStream KV store for thundering herd optimization using revision-based compare-and-swap.

## Pub/Sub Subjects

Three NATS subjects carry notifications (configurable prefix, default `queuert`):

| Subject           | Published When      | Payload Format | Purpose                       |
| ----------------- | ------------------- | -------------- | ----------------------------- |
| `{prefix}.sched`  | Jobs become pending | `{typeName}`   | Wake idle workers             |
| `{prefix}.chainc` | Chain completes     | `{chainId}`    | Wake clients awaiting results |
| `{prefix}.owls`   | Lease reaped        | `{jobId}`      | Notify ownership loss         |

NATS core pub/sub is fire-and-forget — messages are delivered to currently connected subscribers only.

## JetStream KV for Hints

When a JetStream KV bucket is provided, the adapter uses it for thundering herd prevention. Without KV, all listeners query the database on every notification.

### KV Bucket Configuration

The KV bucket is created by the application with a 60-second TTL:

```typescript
const kv = await js.views.kv("queuert_hints", { ttl: 60_000 });
```

### Key Format

```
{subjectPrefix}_hint_{typeName}
```

Example: `queuert_hint_process-order`

### Hint Lifecycle

1. **Create / add**: the publisher calls `provideWakeHint(typeName, count)`. If the key doesn't exist, the adapter creates it with `kv.create`; otherwise it reads the current value and writes back `current + count` via CAS, retrying on revision conflicts.
2. **Decrement**: workers receiving the notification call `consumeWakeHint(typeName)`, which reads the value and revision then attempts an atomic update with the decremented value.
3. **Expire**: keys auto-expire after 60 seconds via the bucket's TTL.

If `consumeWakeHint` finds no key (the budget never existed or expired), it returns `true` — graceful degradation rather than silently missing wakeups.

### Revision-Based CAS

NATS JetStream KV supports optimistic concurrency via revision numbers. Each `kv.put()` returns a revision, and `kv.update()` accepts an expected revision — the update fails if another writer modified the value since it was read:

```
Worker A: kv.get("hint_process-order") → { value: "3", revision: 42 }
Worker B: kv.get("hint_process-order") → { value: "3", revision: 42 }

Worker A: kv.update("hint_process-order", "2", 42) → succeeds (revision 43)
Worker B: kv.update("hint_process-order", "2", 42) → fails ("wrong last sequence")
Worker B: kv.get("hint_process-order") → { value: "2", revision: 43 }
Worker B: kv.update("hint_process-order", "1", 43) → succeeds (revision 44)
```

The adapter retries up to 5 times on "wrong last sequence" errors before giving up. A failed CAS means another writer modified the value — the retrying caller reads the new value and tries again. Both `provideWakeHint` (additive contributions from concurrent publishers) and `consumeWakeHint` (workers racing to claim slots) use the same retry loop.

### Decrement Logic

```
1. Read hint value and revision
2. If key missing: return true (graceful degradation — wake)
3. If value ≤ 0: return false (budget exhausted)
4. Try kv.update(key, value - 1, revision)
5. If success: return true (slot claimed, worker should query database)
6. If "wrong last sequence": retry from step 1 (max 5 times)
7. If max retries exceeded: return false (skip this notification)
```

This provides the same thundering herd prevention as Redis Lua scripts, using NATS-native primitives instead of atomic scripting.

## Without JetStream KV

When no KV bucket is provided, `provideWakeHint`/`consumeWakeHint` become no-ops:

- `provideWakeHint` does nothing
- `consumeWakeHint` always returns `true`
- `notifyJobScheduled` still publishes
- All listeners wake on every notification; the database (`FOR UPDATE SKIP LOCKED` in PostgreSQL, exclusive locking in SQLite) prevents duplicate processing

This mode is simpler to deploy but generates more database queries under high worker counts.

## Shared Listener Pattern

The NATS adapter uses the same shared listener pattern as Redis — a single NATS subscription per subject with multiplexed callbacks:

- **Lazy start**: Subscription created on first listener registration
- **Shared**: Additional listeners attach without new subscriptions
- **Lazy stop**: Subscription torn down when last listener unsubscribes
- **Serialization**: All mutations serialize on a single async write lock — no intermediate `starting`/`stopping` states

## Connection Model

NATS uses a single connection (`NatsConnection`) for both publishing and subscribing — unlike Redis, there is no need for separate connections. The adapter accepts the connection directly:

```typescript
createNatsNotifyAdapter({
  nc, // NatsConnection
  kv, // Optional: JetStream KV bucket
  subjectPrefix, // Optional: default "queuert"
});
```

## See Also

- [Adapter Architecture](../adapters/) — Hint-based optimization design
- [NATS Reference](/queuert/reference/nats/) — API documentation
- [Redis Internals](../redis-internals/) — Alternative notify adapter with Lua scripts
