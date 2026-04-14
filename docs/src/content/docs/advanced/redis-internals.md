---
title: Redis Internals
description: Pub/sub channels, hint keys, and Lua scripts in the Redis notify adapter.
sidebar:
  order: 9
---

## Overview

This document describes the internal implementation of `@queuert/redis`. Redis is used exclusively as a **notification adapter** — it does not store job state. Job storage is handled by a separate state adapter (PostgreSQL or SQLite). Redis provides low-latency pub/sub notifications to wake workers when jobs are scheduled, with an atomic hint mechanism to prevent thundering herd.

## Data Structures

### Pub/Sub Channels

Three channels carry notifications between processes (configurable prefix, default `queuert`):

| Channel           | Published When      | Payload Format        | Purpose                       |
| ----------------- | ------------------- | --------------------- | ----------------------------- |
| `{prefix}:sched`  | Jobs become pending | `{hintId}:{typeName}` | Wake idle workers             |
| `{prefix}:chainc` | Chain completes     | `{chainId}`           | Wake clients awaiting results |
| `{prefix}:owls`   | Lease reaped        | `{jobId}`             | Notify ownership loss         |

Channels use Redis Pub/Sub — messages are fire-and-forget with no persistence. If no subscriber is listening when a message is published, it is lost. This is acceptable because workers fall back to polling when notifications are missed.

### Hint Keys

Hint counters are stored as Redis strings with a 60-second TTL:

```
{prefix}:hint:{hintId}
```

- **Type**: String (integer value)
- **TTL**: 60 seconds (auto-expires)
- **Value**: Number of jobs available for workers to claim

Example: `queuert:hint:550e8400-e29b-41d4-a716-446655440000` → `"5"`

Each `notifyJobScheduled` call generates a unique hint ID (UUID), sets the counter to the job count, and publishes the hint ID with the type name. Workers receiving the notification atomically decrement the counter — only workers that successfully decrement proceed to query the database.

## Lua Scripts

Two Lua scripts ensure atomicity for hint operations. Redis executes Lua scripts atomically — no other command can interleave.

### SET and PUBLISH

Atomically creates a hint counter and publishes the notification:

```lua
redis.call('SET', KEYS[1], ARGV[1], 'EX', 60)
redis.call('PUBLISH', ARGV[2], ARGV[3])
```

- `KEYS[1]`: Hint key (e.g., `queuert:hint:{hintId}`)
- `ARGV[1]`: Job count
- `ARGV[2]`: Channel (e.g., `queuert:sched`)
- `ARGV[3]`: Message payload (`{hintId}:{typeName}`)

Atomicity prevents a race where a worker receives the notification before the hint counter exists.

The channel is passed via `ARGV` rather than `KEYS` so the script declares only one key. On Redis Cluster, all `KEYS[]` declared by an `EVAL` must hash to the same slot; the server rejects the script pre-execution otherwise (`CROSSSLOT`). `PUBLISH` is slot-agnostic — it broadcasts across the cluster — so the channel name does not need to participate in slot routing, and declaring it as a key would only cause spurious cross-slot rejections.

### Decrement If Positive

Atomically decrements the hint counter, returning whether the worker should query:

```lua
local result = redis.call('DECR', KEYS[1])
if result >= 0 then
    return 1
end
redis.call('SET', KEYS[1], '0')
return 0
```

- Returns `1`: Counter was positive — worker should query the database
- Returns `0`: Counter was already zero or negative — worker should skip

If `DECR` goes below zero (more workers than jobs), the script resets to `0` to prevent unbounded negative drift.

## Thundering Herd Prevention

The hint mechanism ensures that when N jobs are scheduled, approximately N workers query the database — not all idle workers:

```
1. notifyJobScheduled("process-order", 3)
2. SET queuert:hint:{uuid} "3" EX 60
3. PUBLISH queuert:sched "{uuid}:process-order"

Workers A, B, C, D, E receive the notification:
  A: DECR hint → 2 (≥0) → queries database ✓
  B: DECR hint → 1 (≥0) → queries database ✓
  C: DECR hint → 0 (≥0) → queries database ✓
  D: DECR hint → -1 (<0) → SET 0, skips ✗
  E: DECR hint → -1 (<0) → SET 0, skips ✗
```

Without hints, all 5 workers would query the database for 3 available jobs — wasted I/O. With hints, only 3 query. The hint counter has a 60-second TTL as a safety net — if a worker crashes before decrementing, the key expires naturally.

## Connection Model

Redis Pub/Sub requires **two separate connections**:

1. **Command client** — for `PUBLISH`, `SET`, and `EVAL` (Lua scripts). Cannot be in subscribe mode.
2. **Subscription client** — for `SUBSCRIBE`/`UNSUBSCRIBE`. Blocked in subscribe mode, cannot execute regular commands.

The `RedisNotifyProvider` interface abstracts this — users manage the two connections in their provider implementation. The `createNodeRedisNotifyProvider` helper handles this for the `redis` npm package.

## Shared Listener Pattern

The adapter multiplexes multiple application-level listeners onto a single Redis subscription per channel:

```
Channel: queuert:sched
  └── Redis SUBSCRIBE (single connection)
      ├── Worker A callback (filters for "process-order")
      ├── Worker B callback (filters for "send-email")
      └── Worker C callback (filters for "process-order")
```

The shared listener tracks state transitions: `idle` → `starting` → `running` → `stopping`:

- **Lazy start**: The Redis subscription is created when the first listener registers
- **Shared**: Additional listeners attach callbacks without creating new subscriptions
- **Lazy stop**: The subscription is torn down when the last listener unsubscribes

This avoids creating a separate Redis subscription for each worker or job type.

## See Also

- [Adapter Architecture](../adapters/) — Hint-based optimization design
- [Redis Reference](/queuert/reference/redis/) — API documentation
- [NATS Internals](../nats-internals/) — Alternative notify adapter
