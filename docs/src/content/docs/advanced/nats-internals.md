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

| Subject           | Published When      | Payload Format        | Purpose                       |
| ----------------- | ------------------- | --------------------- | ----------------------------- |
| `{prefix}.sched`  | Jobs become pending | `{hintId}:{typeName}` | Wake idle workers             |
| `{prefix}.chainc` | Chain completes     | `{chainId}`           | Wake clients awaiting results |
| `{prefix}.owls`   | Lease reaped        | `{jobId}`             | Notify ownership loss         |

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
{subjectPrefix}_hint_{hintId}
```

Example: `queuert_hint_550e8400-e29b-41d4-a716-446655440000`

### Hint Lifecycle

1. **Create**: `notifyJobScheduled` generates a UUID hint ID, puts the job count as the value, then publishes the notification
2. **Decrement**: Workers receiving the notification read the hint value and its revision, then attempt an atomic update with the decremented value
3. **Expire**: Keys auto-expire after 60 seconds via the bucket's TTL

### Revision-Based CAS

NATS JetStream KV supports optimistic concurrency via revision numbers. Each `kv.put()` returns a revision, and `kv.update()` accepts an expected revision — the update fails if another writer modified the value since it was read:

```
Worker A: kv.get("hint_abc") → { value: "3", revision: 42 }
Worker B: kv.get("hint_abc") → { value: "3", revision: 42 }

Worker A: kv.update("hint_abc", "2", 42) → succeeds (revision 43)
Worker B: kv.update("hint_abc", "2", 42) → fails ("wrong last sequence")
Worker B: kv.get("hint_abc") → { value: "2", revision: 43 }
Worker B: kv.update("hint_abc", "1", 43) → succeeds (revision 44)
```

The adapter retries up to 5 times on "wrong last sequence" errors before giving up. A failed CAS means another worker already claimed the slot — the retrying worker reads the updated value and tries again with the new revision.

### Decrement Logic

```
1. Read hint value and revision
2. If value ≤ 0: return false (no jobs to claim)
3. Try kv.update(key, value - 1, revision)
4. If success: return true (worker should query database)
5. If "wrong last sequence": retry from step 1 (max 5 times)
6. If max retries exceeded: return false (skip this notification)
```

This provides the same thundering herd prevention as Redis Lua scripts, using NATS-native primitives instead of atomic scripting.

## Without JetStream KV

When no KV bucket is provided, the adapter skips hint optimization entirely:

- `notifyJobScheduled` publishes the notification without creating a hint
- All listeners query the database on every notification
- Job acquisition still works correctly — `FOR UPDATE SKIP LOCKED` (PostgreSQL) or exclusive locking (SQLite) prevents duplicate processing

This mode is simpler to deploy but generates more database queries under high worker counts.

## Shared Listener Pattern

The NATS adapter uses the same shared listener pattern as Redis — a single NATS subscription per subject with multiplexed callbacks:

- **Lazy start**: Subscription created on first listener registration
- **Shared**: Additional listeners attach without new subscriptions
- **Lazy stop**: Subscription torn down when last listener unsubscribes
- **State machine**: Tracks `idle` → `starting` → `running` → `stopping` transitions

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
