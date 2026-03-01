---
title: Memory Footprint
description: Memory footprint measurements for Queuert adapters.
sidebar:
  order: 5
---

Queuert adapters add minimal overhead on top of the database/messaging drivers (Node.js v24, `--expose-gc`):

| State Adapter | Adapter Overhead |
| ------------- | ---------------- |
| PostgreSQL    | ~290 KB          |
| SQLite        | ~45 KB           |

| Notify Adapter | Adapter Overhead |
| -------------- | ---------------- |
| Redis          | ~11 KB           |
| PostgreSQL     | ~10 KB           |
| NATS           | ~11 KB           |

| Component             | Overhead |
| --------------------- | -------- |
| Observability Adapter | ~145 KB  |

See [benchmark-memory-footprint](https://github.com/kvet/queuert/tree/main/examples/benchmark-memory-footprint) for the full measurement tool.
