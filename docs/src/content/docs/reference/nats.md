---
title: "@queuert/nats"
description: NATS notify adapter.
sidebar:
  order: 8
---

:::caution
This package is experimental and may change without notice.
:::

## createNatsNotifyAdapter

```typescript
const notifyAdapter = await createNatsNotifyAdapter({
  nc: NatsConnection,            // NATS connection from the 'nats' package
  kv?: KV,                       // Optional JetStream KV for thundering herd optimization (see below)
  subjectPrefix?: string,        // Subject prefix (default: "queuert")
});
```

Returns `Promise<NotifyAdapter>`.

No provider type is exported — NATS accepts the `NatsConnection` directly. There is only one NATS client in the Node.js ecosystem, so no adapter layer is needed.

When **kv** is provided, the adapter uses a JetStream KV store to deduplicate notifications so that only one worker wakes up per scheduled job instead of all workers simultaneously (thundering herd prevention).

## See Also

- [Notify Adapters](/queuert/integrations/notify-adapters/) — Integration guide for notify adapters
- [Adapter Architecture](/queuert/advanced/adapters/) — Design philosophy and context management
