---
title: Benchmarks
description: Memory footprint and type complexity benchmarks for Queuert.
sidebar:
  order: 5
---

## Memory Footprint

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

## Type Complexity

Queuert's type-level machinery scales moderately across chain patterns (tsgo 7.0.0-dev, prebuilt `.d.mts`):

| Scenario             | Job Types |  Time | Instantiations | Memory | Scaling |
| -------------------- | --------: | ----: | -------------: | -----: | ------: |
| Linear: 3 types      |         6 | 104ms |         21,491 |   59MB |    1.0x |
| Linear: 10 types     |        20 | 114ms |         30,206 |   60MB |    1.4x |
| Linear: 30 types     |        60 | 126ms |         61,586 |   63MB |    2.9x |
| Branched: 4w x 3d    |       170 | 191ms |        174,386 |   71MB |    8.1x |
| Blockers: 8 steps    |        60 | 126ms |         71,360 |   64MB |    3.3x |
| Loop: 20 steps       |        42 | 120ms |         46,493 |   62MB |    2.2x |
| Merge: 4 slices x 10 |        80 | 134ms |         76,146 |   67MB |    3.5x |
| Many: 20 x 3-step    |       120 | 166ms |        117,310 |   72MB |    5.5x |

| Configuration                                | tsc        | tsgo       |
| -------------------------------------------- | ---------- | ---------- |
| Up to 30 types in a single chain             | OK, <600ms | OK, <130ms |
| Branched chains up to 4w x 3d (~170 types)   | OK, <850ms | OK, ~190ms |
| Blockers: up to 8 steps with 3 blockers each | OK, <580ms | OK, <130ms |
| Merging up to 4 slices of 10 types           | OK, <630ms | OK, <140ms |
| Many: 20 slices x 3-step chains (120 types)  | OK, <690ms | OK, <170ms |

See [benchmark-type-complexity](https://github.com/kvet/queuert/tree/main/examples/benchmark-type-complexity) for the full benchmark tool and detailed analysis.
