---
title: "@queuert/redis"
description: Redis notify adapter.
sidebar:
  order: 7
---

## createRedisNotifyAdapter

```typescript
const notifyAdapter = await createRedisNotifyAdapter({
  provider: RedisNotifyProvider,   // You implement this
  channelPrefix?: string,          // Channel prefix (default: "queuert")
});
```

Returns `Promise<NotifyAdapter>`.

## RedisNotifyProvider

**RedisNotifyProvider** — you implement this. Note the `eval` method for Lua scripts (thundering herd optimization):

```typescript
type RedisNotifyProvider = {
  publish: (channel: string, message: string) => Promise<void>;
  subscribe: (
    channel: string,
    onMessage: (message: string) => void,
  ) => Promise<() => Promise<void>>;
  eval: (script: string, keys: string[], args: string[]) => Promise<unknown>;
};
```

Redis requires two separate connections because clients in subscribe mode cannot run other commands.

## See Also

- [Notify Adapters](/queuert/integrations/notify-adapters/) — Integration guide for notify adapters
- [Adapter Architecture](/queuert/advanced/adapters/) — Design philosophy and context management
