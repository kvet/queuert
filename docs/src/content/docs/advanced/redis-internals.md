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

| Channel           | Published When      | Payload Format | Purpose                       |
| ----------------- | ------------------- | -------------- | ----------------------------- |
| `{prefix}:sched`  | Jobs become pending | `{typeName}`   | Wake idle workers             |
| `{prefix}:chainc` | Chain completes     | `{chainId}`    | Wake clients awaiting results |
| `{prefix}:owls`   | Lease reaped        | `{jobId}`      | Notify ownership loss         |

Channels use Redis Pub/Sub — messages are fire-and-forget with no persistence. If no subscriber is listening when a message is published, it is lost. This is acceptable because workers fall back to polling when notifications are missed.

### Hint Keys

Hint counters are stored as Redis strings keyed by typeName, with a 60-second TTL:

```
{prefix}:hint:{typeName}
```

- **Type**: String (integer value)
- **TTL**: 60 seconds (auto-expires; refreshed on each `provideWakeHint` call)
- **Value**: Cumulative wakeup budget contributed by all publishers

Example: `queuert:hint:process-order` → `"5"`

Hints are managed via the `provideWakeHint`/`consumeWakeHint` pair on `NotifyAdapter`. The publisher calls `provideWakeHint(typeName, count)` (which adds `count` to the budget for this typeName), then `notifyJobScheduled(typeName)`. Workers receiving the notification call `consumeWakeHint(typeName)` and only query the database if the call returns `true`. Concurrent publishers contributing to the same typeName compose additively — two `provideWakeHint(t, 3)` calls produce a budget of 6.

## Lua Scripts

Two Lua scripts ensure atomicity for hint operations. Redis executes Lua scripts atomically — no other command can interleave.

### Provide Wake Hint

Adds `count` to the hint counter, refreshing the 60-second TTL:

```lua
local current = tonumber(redis.call('GET', KEYS[1])) or 0
redis.call('SET', KEYS[1], current + tonumber(ARGV[1]), 'EX', 60)
```

- `KEYS[1]`: Hint key (e.g., `queuert:hint:process-order`)
- `ARGV[1]`: Count to add

The atomic GET-then-SET ensures concurrent `provideWakeHint` calls compose additively without losing increments. The TTL refresh keeps long-lived budgets alive across notification batches.

### Consume Wake Hint

Atomically claims one slot of the budget, returning whether the worker should wake:

```lua
local current = redis.call('GET', KEYS[1])
if not current then
  return 1
end
local n = tonumber(current)
if n and n > 0 then
  redis.call('DECR', KEYS[1])
  return 1
end
return 0
```

- Returns `1`: caller should wake (slot claimed, **or** hint key absent — graceful degradation)
- Returns `0`: budget exhausted by other consumers

The `not current` branch is the graceful-degradation case: if the hint key never existed or the TTL expired, listeners wake unconditionally rather than silently miss notifications. This trades a one-shot thundering herd for never losing a wakeup.

## Thundering Herd Prevention

The hint mechanism ensures that when N jobs are scheduled for a typeName, approximately N workers query the database — not all idle workers:

```
1. provideWakeHint("process-order", 3) → SET queuert:hint:process-order "3" EX 60
2. notifyJobScheduled("process-order")  → PUBLISH queuert:sched "process-order"

Workers A, B, C, D, E receive the notification:
  A: consumeWakeHint("process-order") → DECR hint to 2 → returns 1 → queries database ✓
  B: consumeWakeHint("process-order") → DECR hint to 1 → returns 1 → queries database ✓
  C: consumeWakeHint("process-order") → DECR hint to 0 → returns 1 → queries database ✓
  D: consumeWakeHint("process-order") → GET hint = "0" → returns 0 → skips ✗
  E: consumeWakeHint("process-order") → GET hint = "0" → returns 0 → skips ✗
```

Concurrent publishers compose: if two publishers each schedule 3 jobs of `process-order`, both call `provideWakeHint(t, 3)`, the budget becomes 6, and 6 workers wake across the two notifications.

Without hints, all 5 workers would query the database for 3 available jobs — wasted I/O. With hints, only 3 query. The hint counter has a 60-second TTL refreshed on each `provideWakeHint` call — if a budget goes unused, it eventually expires and the next notification triggers graceful-degradation wakeup.

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

All mutations (subscribe / unsubscribe / dispose) serialize on a single async write lock so concurrent callers execute one at a time. The state is just `running` or `not running` — no intermediate `starting`/`stopping` bookkeeping.

- **Lazy start**: The Redis subscription is created when the first listener registers.
- **Shared**: Additional listeners attach callbacks without creating new subscriptions.
- **Lazy stop**: The subscription is torn down when the last listener unsubscribes.

This avoids creating a separate Redis subscription for each worker or job type.

## See Also

- [Adapter Architecture](../adapters/) — Hint-based optimization design
- [Redis Reference](/queuert/reference/redis/) — API documentation
- [NATS Internals](../nats-internals/) — Alternative notify adapter
