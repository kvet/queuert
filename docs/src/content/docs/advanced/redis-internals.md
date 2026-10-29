---
title: Redis Internals
description: Pub/sub channels and the publish script in the Redis notify adapter.
sidebar:
  order: 9
---

## Overview

This document describes the internal implementation of `@queuert/redis`. Redis is used exclusively as a **notification adapter** — it does not store job state. Job storage is handled by a separate state adapter (PostgreSQL or SQLite). Redis provides low-latency pub/sub notifications to wake workers when jobs are scheduled.

## Data Structures

### Pub/Sub Channels

Three channels carry notifications between processes (configurable prefix, default `queuert`):

| Channel           | Published When      | Payload Format | Purpose                       |
| ----------------- | ------------------- | -------------- | ----------------------------- |
| `{prefix}:sched`  | Jobs become pending | `{typeName}`   | Wake idle workers             |
| `{prefix}:chainc` | Chain completes     | `{chainId}`    | Wake clients awaiting results |
| `{prefix}:atls`   | Attempt reclaimed   | `{jobId}`      | Notify attempt loss           |

Channels use Redis Pub/Sub — messages are fire-and-forget with no persistence. If no subscriber is listening when a message is published, it is lost. This is acceptable because workers fall back to polling when notifications are missed.

## Publish Script

`notifyJobsScheduled`, `notifyChainsCompleted` and `notifyJobAttemptsLost` each publish their whole batch on one channel in a single `EVAL`, so a commit that schedules several types, completes several chains, or loses several attempts costs one round-trip per method. The script touches no keys, so on Redis Cluster it can run on any node:

```lua
for i = 2, #ARGV do
  redis.call('PUBLISH', ARGV[1], ARGV[i])
end
```

- `ARGV[1]`: Channel (`{prefix}:sched`, `{prefix}:chainc` or `{prefix}:atls`)
- `ARGV[2..n]`: Type names, chain ids or job ids

How workers react to a job-scheduled message is described in [Adapter Architecture](../adapters/#waking-workers).

## Connection Model

Redis Pub/Sub requires **two separate connections**:

1. **Command client** — for `EVAL` (the publish script, which runs `PUBLISH`). Cannot be in subscribe mode.
2. **Subscription client** — for `SUBSCRIBE`/`UNSUBSCRIBE`. Blocked in subscribe mode, cannot execute regular commands.

The `RedisNotifyProvider` interface abstracts this — users manage the two connections in their provider implementation.

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

- [Adapter Architecture](../adapters/) — Notify adapter design
- [Redis Reference](/queuert/api/redis/readme/) — API documentation
- [NATS Internals](../nats-internals/) — Alternative notify adapter
