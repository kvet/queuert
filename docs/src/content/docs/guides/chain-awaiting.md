---
title: Awaiting Chains
description: Wait for job chains to complete with polling and notifications.
sidebar:
  order: 11
---

`awaitJobChain` waits for a job chain to complete by combining polling with notify adapter events. Between polls, it listens for completion notifications to react immediately.

```ts
const completedJobChain = await client.awaitJobChain(
  { id: jobChainId },
  { timeoutMs: 30_000, pollIntervalMs: 5_000 },
);

console.log(completedJobChain.output); // Typed output from the final job
```

Throws `WaitChainTimeoutError` on timeout. Supports an `AbortSignal` for cancellation.

See [examples/showcase-chain-awaiting](https://github.com/kvet/queuert/tree/main/examples/showcase-chain-awaiting) for a complete working example demonstrating basic awaiting, parallel awaiting, timeout handling, and abort signals.
