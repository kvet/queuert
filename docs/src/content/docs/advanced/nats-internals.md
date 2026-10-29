---
title: NATS Internals
description: Pub/sub subjects and connection model in the NATS notify adapter.
sidebar:
  order: 10
---

## Overview

This document describes the internal implementation of `@queuert/nats`. Like Redis, NATS is used exclusively as a **notification adapter** — it does not store job state. NATS provides core pub/sub notifications to wake workers when jobs are scheduled.

## Pub/Sub Subjects

Three NATS subjects carry notifications (configurable prefix, default `queuert`):

| Subject           | Published When      | Payload Format | Purpose                       |
| ----------------- | ------------------- | -------------- | ----------------------------- |
| `{prefix}.sched`  | Jobs become pending | `{typeName}`   | Wake idle workers             |
| `{prefix}.chainc` | Chain completes     | `{chainId}`    | Wake clients awaiting results |
| `{prefix}.atls`   | Attempt reclaimed   | `{jobId}`      | Notify attempt loss           |

NATS core pub/sub is fire-and-forget — messages are delivered to currently connected subscribers only. Each notify method publishes every item of its batch, then calls `flush()` once, so a batch costs one round-trip. Every idle worker subscribed to a type wakes on its `{prefix}.sched` message and queries the database; the database (`FOR UPDATE SKIP LOCKED` in PostgreSQL, exclusive locking in SQLite) settles which worker gets each job.

## Shared Listener Pattern

The NATS adapter uses the same shared listener pattern as Redis — a single NATS subscription per subject with multiplexed callbacks:

- **Lazy start**: Subscription created on first listener registration
- **Shared**: Additional listeners attach without new subscriptions
- **Lazy stop**: Subscription torn down when last listener unsubscribes
- **Serialization**: All mutations serialize on a single async write lock — no intermediate `starting`/`stopping` states

## Connection Model

NATS uses a single connection (`NatsConnection`) for both publishing and subscribing — unlike Redis, there is no need for separate connections. The adapter accepts the connection directly:

```typescript
const notifyAdapter = await createNatsNotifyAdapter({
  nc, // NatsConnection
  subjectPrefix, // Optional: default "queuert"
});
```

## See Also

- [Adapter Architecture](../adapters/) — Notify adapter design
- [NATS Reference](/queuert/api/nats/readme/) — API documentation
- [Redis Internals](../redis-internals/) — Alternative notify adapter
