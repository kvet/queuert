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

See [benchmark-memory-footprint](https://github.com/kvet/queuert/tree/main/benchmarks/benchmark-memory-footprint) for the full measurement tool.

## Type Complexity

Queuert's type-level machinery scales linearly across chain topologies (prebuilt `.d.mts`):

### tsc (5.9.3)

| Scenario           | Types |     Time | Instantiations | Memory | Scaling |
| ------------------ | ----: | -------: | -------------: | -----: | ------: |
| Linear: 1 type     |     1 |   ~510ms |         14,619 |  111MB |    1.0x |
| Linear: 10 types   |    10 |   ~500ms |         26,381 |  114MB |    1.8x |
| Linear: 50 types   |    50 |   ~690ms |         76,021 |  131MB |    5.2x |
| Linear: 100 types  |   100 |   ~940ms |        138,071 |  156MB |    9.4x |
| Branched: 4w x 3d  |    85 |   ~900ms |         95,314 |  146MB |    6.5x |
| Branched: 2w x 6d  |   127 | ~1,350ms |        148,024 |  168MB |   10.1x |
| Blockers: 8 steps  |    30 |   ~710ms |         49,562 |  124MB |    3.4x |
| Blockers: 25 steps |    98 | ~1,010ms |        158,464 |  155MB |   10.8x |
| Loop: 20 steps     |    21 |   ~690ms |         41,423 |  122MB |    2.8x |
| Loop: 50 steps     |    51 |   ~910ms |         80,783 |  144MB |    5.5x |
| Merge: 2 x 50      |   100 | ~1,240ms |        129,115 |  153MB |    8.8x |
| Merge: 5 x 50      |   250 | ~1,490ms |        292,588 |  198MB |   20.0x |
| Merge: 10 x 50     |   500 | ~2,160ms |        565,369 |  292MB |   38.7x |
| Merge: 20 x 50     | 1,000 | ~3,840ms |      1,109,976 |  493MB |   75.9x |
| Merge: 50 x 50     | 2,500 |   ~11.0s |      2,748,689 |  855MB |  188.0x |

### Practical limits

| Configuration                              | Status          |
| ------------------------------------------ | --------------- |
| Up to 100 types in a single linear chain   | OK, <1s (tsc)   |
| Branched chains up to 2w x 6d (~127 types) | OK, ~1.4s (tsc) |
| Blockers: up to 25 steps, 3 blockers each  | OK, ~1s (tsc)   |
| Loops: up to 50 self-referencing steps     | OK, <1s (tsc)   |
| Merging 10 slices of 50 types (500 total)  | OK, ~2.2s (tsc) |
| Merging 50 slices of 50 types (2500 total) | OK, ~11s (tsc)  |

See [benchmark-type-complexity](https://github.com/kvet/queuert/tree/main/benchmarks/benchmark-type-complexity) for the full benchmark tool and detailed results.
