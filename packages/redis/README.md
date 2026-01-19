# @queuert/redis

Redis notify adapter for [Queuert](https://github.com/kvet/queuert) - a TypeScript library for database-backed job queues.

## What does this do?

[Queuert](https://github.com/kvet/queuert) separates job storage (state adapter) from worker coordination (notify adapter). This package provides a **notify adapter** that uses Redis pub/sub.

The notify adapter handles:

- Broadcasting job scheduling events so workers wake up immediately
- Signaling chain completion for `waitForJobChainCompletion`
- **Thundering herd optimization** - Uses Lua scripts to atomically limit how many workers query the database

## When to use Redis

- **High-throughput systems** - Redis pub/sub is fast and reliable
- **Many workers** - Thundering herd optimization prevents database overload
- **Existing Redis infrastructure** - If you already use Redis for caching/sessions

This is a notify adapter only. You still need a state adapter ([PostgreSQL](https://github.com/kvet/queuert/tree/main/packages/postgres), [SQLite](https://github.com/kvet/queuert/tree/main/packages/sqlite), or [MongoDB](https://github.com/kvet/queuert/tree/main/packages/mongodb)) to store jobs.

## Installation

```bash
npm install @queuert/redis
```

**Peer dependencies:** `queuert`

## Quick Start

```typescript
import { createQueuertClient, createConsoleLog, defineJobTypes } from 'queuert';
import { createPgStateAdapter } from '@queuert/postgres';
import { createRedisNotifyAdapter } from '@queuert/redis';
import { createClient } from 'redis';

const jobTypes = defineJobTypes<{
  'send-email': { entry: true; input: { to: string }; output: { sent: true } };
}>();

const stateAdapter = await createPgStateAdapter({ stateProvider: myPgProvider });

// Redis requires two separate connections (subscribe mode is exclusive)
const redis = createClient();
const redisSubscription = createClient();
await redis.connect();
await redisSubscription.connect();

const notifyAdapter = await createRedisNotifyAdapter({
  provider: {
    publish: async (channel, message) => {
      await redis.publish(channel, message);
    },
    subscribe: async (channel, onMessage) => {
      await redisSubscription.subscribe(channel, onMessage);
      return async () => {
        await redisSubscription.unsubscribe(channel);
      };
    },
    eval: async (script, keys, args) => {
      return redis.eval(script, { keys, arguments: args });
    },
  },
});

const client = await createQueuertClient({
  stateAdapter,
  notifyAdapter,
  jobTypeRegistry: jobTypes,
  log: createConsoleLog(),
});
```

## Configuration

```typescript
const notifyAdapter = await createRedisNotifyAdapter({
  provider: myRedisNotifyProvider,  // You provide this - see Quick Start
  channelPrefix: 'queuert',         // Channel prefix (default: "queuert")
});
```

## How it works

- Uses 3 fixed channels with payload-based filtering (same pattern as PostgreSQL LISTEN/NOTIFY)
- When N jobs are scheduled, only N workers query the database (via atomic Lua script decrements)
- Requires two Redis connections because Redis clients in subscribe mode can't run other commands

## Exports

### Main (`.`)

- `createRedisNotifyAdapter` - Factory to create Redis notify adapter
- `RedisNotifyProvider` - Type for the Redis notify provider

### Testing (`./testing`)

- `extendWithNotifyRedis` - Test context helper for Redis notify adapter

## Documentation

For full documentation, examples, and API reference, see the [main Queuert README](https://github.com/kvet/queuert#readme).
