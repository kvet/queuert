# @queuert/nats

[![npm version](https://img.shields.io/npm/v/@queuert/nats.svg)](https://www.npmjs.com/package/@queuert/nats)
![experimental](https://img.shields.io/badge/status-experimental-orange.svg)
[![license](https://img.shields.io/github/license/kvet/queuert.svg)](https://github.com/kvet/queuert/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/kvet/queuert.svg)](https://github.com/kvet/queuert)
[![last commit](https://img.shields.io/github/last-commit/kvet/queuert.svg)](https://github.com/kvet/queuert/commits)

> **Experimental**: This adapter's API may change significantly. For production use, consider [@queuert/redis](https://github.com/kvet/queuert/tree/main/packages/redis).

NATS notify adapter for [Queuert](https://github.com/kvet/queuert) - a TypeScript library for database-backed job queues.

## What does this do?

[Queuert](https://github.com/kvet/queuert) separates job storage (state adapter) from worker coordination (notify adapter). This package provides a **notify adapter** that uses NATS messaging.

The notify adapter handles:

- Broadcasting job scheduling events so workers wake up immediately
- Signaling chain completion for `waitForJobChainCompletion`
- **Optional thundering herd optimization** - With JetStream KV, limits how many workers query the database

## When to use NATS

- **Cloud-native deployments** - NATS is lightweight and Kubernetes-friendly
- **Existing NATS infrastructure** - If you already use NATS for messaging
- **Single connection** - Unlike Redis, NATS is fully multiplexed (one connection for both pub and sub)
- **Optional persistence** - JetStream KV enables thundering herd optimization

This is a notify adapter only. You still need a state adapter ([PostgreSQL](https://github.com/kvet/queuert/tree/main/packages/postgres) or [SQLite](https://github.com/kvet/queuert/tree/main/packages/sqlite)) to store jobs.

## Installation

```bash
npm install @queuert/nats
```

**Peer dependencies:** `queuert`, `nats` (requires ^2.28.0)

## Quick Start

```typescript
import { createClient, createConsoleLog, defineJobTypes } from "queuert";
import { createPgStateAdapter } from "@queuert/postgres";
import { createNatsNotifyAdapter } from "@queuert/nats";
import { connect } from "nats";

const jobTypes = defineJobTypes<{
  "send-email": { entry: true; input: { to: string }; output: { sent: true } };
}>();

const stateAdapter = await createPgStateAdapter({ stateProvider: myPgProvider });

const nc = await connect({ servers: "localhost:4222" });

const notifyAdapter = await createNatsNotifyAdapter({
  nc,
  // Optional: enable thundering herd optimization with JetStream KV
  // kv: await nc.jetstream().views.kv('queuert-hints'),
});

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  registry: jobTypes,
  log: createConsoleLog(),
});
```

## Configuration

```typescript
const notifyAdapter = await createNatsNotifyAdapter({
  nc: natsConnection, // NATS connection
  kv: jetStreamKvBucket, // Optional JetStream KV bucket for hint optimization
  subjectPrefix: "queuert", // Subject prefix (default: "queuert")
});
```

## How it works

- Uses 3 NATS subjects with payload-based filtering (`{prefix}.sched`, `{prefix}.chainc`, `{prefix}.owls`)
- Without JetStream KV: all listeners query database (same as PostgreSQL LISTEN/NOTIFY)
- With JetStream KV: uses revision-based CAS operations to limit database queries

## Exports

### Main (`.`)

- `createNatsNotifyAdapter` - Factory to create NATS notify adapter
- `NatsNotifyAdapter` - Type for the NATS notify adapter

Unlike Redis and PostgreSQL, no provider type is exported because NATS accepts the `NatsConnection` directly from the `nats` package. There's only one NATS client in the Node.js ecosystem, so no adapter layer is needed.

### Testing (`./testing`)

- `extendWithNotifyNats` - Test context helper for NATS notify adapter

## Documentation

For full documentation, examples, and API reference, see the [main Queuert README](https://github.com/kvet/queuert#readme).
