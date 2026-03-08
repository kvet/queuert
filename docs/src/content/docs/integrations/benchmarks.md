---
title: Benchmarks
description: Memory footprint and type complexity benchmarks for Queuert.
sidebar:
  order: 5
---

## Memory Footprint

Heap overhead of each Queuert component, measured in isolation with `--expose-gc` and forced GC before/after each step (Node.js v22). "Driver" is the database/messaging client connection; "Adapter" is the Queuert layer including schema migrations; "Client + Worker" is the Queuert client and in-process worker setup.

| State Adapter |  Driver | Adapter + Migrations | Client + Worker |
| ------------- | ------: | -------------------: | --------------: |
| PostgreSQL    | ~183 KB |              ~282 KB |         ~113 KB |
| SQLite        |  ~79 KB |               ~43 KB |         ~139 KB |

| Notify Adapter |  Driver | Adapter | Client + Worker |
| -------------- | ------: | ------: | --------------: |
| Redis          | ~437 KB |   ~9 KB |         ~130 KB |
| PostgreSQL     | ~184 KB |   ~9 KB |         ~236 KB |
| NATS           | ~193 KB |  ~10 KB |         ~122 KB |

| Component            | Heap Overhead | Notes                                        |
| -------------------- | ------------: | -------------------------------------------- |
| Observability (OTel) |       ~135 KB | Adapter only; OTel MeterProvider adds ~21 KB |
| Dashboard            |         ~2 KB | First API request loads ~1.7 MB of assets    |

See [benchmark-memory-footprint](https://github.com/kvet/queuert/tree/main/examples/benchmark-memory-footprint) for the full measurement tool.

## Type Complexity

Queuert's type-level machinery scales linearly across chain topologies (tsc 5.9.3, prebuilt `.d.mts`):

| Scenario           | Types |    Time | Instantiations | Memory | Scaling |
| ------------------ | ----: | ------: | -------------: | -----: | ------: |
| Linear: 1 type     |     1 |  ~550ms |         18,883 |  113MB |    1.0x |
| Linear: 10 types   |    10 |  ~560ms |         30,952 |  120MB |    1.6x |
| Linear: 50 types   |    50 |  ~690ms |        102,912 |  133MB |    5.4x |
| Linear: 100 types  |   100 |  ~880ms |        246,862 |  169MB |   13.1x |
| Branched: 4w x 3d  |    85 |  ~860ms |        174,949 |  147MB |    9.3x |
| Branched: 2w x 6d  |   127 | ~1020ms |        327,493 |  162MB |   17.3x |
| Blockers: 8 steps  |    30 |  ~590ms |         73,123 |  128MB |    3.9x |
| Blockers: 25 steps |    98 |  ~930ms |        359,981 |  148MB |   19.1x |
| Loop: 20 steps     |    21 |  ~560ms |         48,249 |  118MB |    2.6x |
| Loop: 50 steps     |    51 |  ~730ms |        108,369 |  141MB |    5.7x |
| Merge: 2 x 100     |   200 | ~1310ms |        577,112 |  218MB |   30.6x |

| Configuration                                 | Status                    |
| --------------------------------------------- | ------------------------- |
| Up to 100 types in a single linear chain      | OK, <900ms                |
| Branched chains up to 2w x 6d (~127 types)    | OK, ~1s                   |
| Blockers: up to 25 steps with 3 blockers each | OK, <1s                   |
| Loops: up to 50 self-referencing steps        | OK, <750ms                |
| Loops: 100 steps                              | TS2589 (recursion depth)  |
| Merging 2 slices of 100 types                 | OK, ~1.3s                 |
| Merging 5 slices of 100 types (500 total)     | TS2590 (union complexity) |

See [benchmark-type-complexity](https://github.com/kvet/queuert/tree/main/examples/benchmark-type-complexity) for the full benchmark tool and detailed analysis.
