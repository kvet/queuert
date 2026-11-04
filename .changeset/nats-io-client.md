---
"@queuert/nats": major
---

The NATS notify adapter now targets the official modular NATS client. The legacy `nats` package is deprecated upstream, so `@queuert/nats` now takes its `NatsConnection` from `@nats-io/nats-core`. Install `@nats-io/transport-node` (or another `@nats-io` transport) and create the connection with its `connect`. The adapter's options and behavior are otherwise unchanged.

- Peer dependency `nats` (^2.8.0) replaced by `@nats-io/nats-core` (^3.0.0)
