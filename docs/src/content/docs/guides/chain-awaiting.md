---
title: Awaiting Chains
description: Wait for chains to complete with polling and notifications.
sidebar:
  order: 11
---

`awaitChain` waits for a chain to complete by combining polling with notify adapter events. Between polls, it listens for completion notifications to react immediately.

```ts
const completedChain = await client.awaitChain(
  { id: chainId },
  { timeoutMs: 30_000, pollIntervalMs: 5_000 },
);

console.log(completedChain.output); // Typed output from the final job
```

Throws `WaitChainTimeoutError` on timeout. Supports an `AbortSignal` for cancellation.

```d2
...@../_classes.d2

direction: right

caller: "awaitChain(id)" { class: client; width: 180; height: 60 }

loop: "wait loop" {
  class: process

  poll: "poll DB\nevery pollIntervalMs" { class: step; width: 200; height: 60 }
  listen: "listen for chain\ncompletion notify" { class: notify; width: 200; height: 60 }
}

resolved: "chain done\nreturn output" { class: job-done; width: 180; height: 60 }
timeout:  "WaitChainTimeoutError\nor abort"        { class: blocker;  width: 220; height: 60 }

caller -> loop.poll   { class: flow }
caller -> loop.listen { class: flow }
loop.poll   -> resolved: "row complete" { class: flow-green }
loop.listen -> resolved: "wake early"   { class: wake }
loop -> timeout: "deadline / abort"     { class: flow-red }
```

See [examples/showcase-chain-awaiting](https://github.com/kvet/queuert/tree/main/examples/showcase-chain-awaiting) for a complete working example demonstrating basic awaiting, parallel awaiting, timeout handling, and abort signals.
