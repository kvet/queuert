---
title: Benchmarks
description: Processing capacity, memory footprint, and type complexity benchmarks for Queuert.
---

## Processing Capacity

End-to-end job throughput measured in two phases: starting job chains (chains/s) and processing them to completion (jobs/s). Each adapter combination runs in a separate child process for isolation (Node.js v22, 10,000 jobs, concurrency 10, Apple M1 Pro).

| State      | Notify     | Start (chains/s) | Process (jobs/s) | End-to-end (jobs/s) |
| ---------- | ---------- | ---------------: | ---------------: | ------------------: |
| PostgreSQL | in-process |             ~473 |             ~433 |                ~226 |
| PostgreSQL | PostgreSQL |             ~428 |             ~436 |                ~216 |
| SQLite     | in-process |          ~10,262 |             ~733 |                ~684 |
| SQLite     | Redis      |           ~3,193 |             ~557 |                ~474 |
| SQLite     | NATS       |           ~8,277 |             ~723 |                ~665 |

See [processing-capacity](https://github.com/kvet/queuert/tree/main/benchmarks/processing-capacity) for the full benchmark tool.

## Memory Footprint

Heap overhead of each Queuert component, measured in isolation with `--expose-gc` and forced GC before/after each step (Node.js v22, Apple M1 Pro). "Driver" is the database/messaging client connection; "Adapter" is the Queuert layer including schema migrations; "Client + Worker" is the Queuert client and in-process worker setup.

| State Adapter |  Driver | Adapter + Migrations | Client + Worker |
| ------------- | ------: | -------------------: | --------------: |
| PostgreSQL    | ~183 KB |              ~281 KB |         ~123 KB |
| SQLite        |  ~78 KB |               ~45 KB |         ~141 KB |

| Notify Adapter |  Driver | Adapter | Client + Worker |
| -------------- | ------: | ------: | --------------: |
| Redis          | ~430 KB |  ~11 KB |         ~150 KB |
| PostgreSQL     | ~180 KB |  ~11 KB |         ~261 KB |
| NATS           | ~184 KB |  ~10 KB |         ~144 KB |

| Component            | Heap Overhead | Notes                                        |
| -------------------- | ------------: | -------------------------------------------- |
| Observability (OTel) |       ~140 KB | Adapter only; OTel MeterProvider adds ~21 KB |
| Dashboard            |         ~2 KB | First API request loads ~1.7 MB of assets    |

See [memory-footprint](https://github.com/kvet/queuert/tree/main/benchmarks/memory-footprint) for the full measurement tool.

## Type Complexity

Queuert's type-level machinery scales linearly across chain topologies (prebuilt `.d.mts`, Node.js v22, Apple M1 Pro):

### tsc (6.0.2)

| Scenario           | Types |     Time | Instantiations | Scaling |
| ------------------ | ----: | -------: | -------------: | ------: |
| Linear: 1 type     |     1 |   ~501ms |         15,735 |    1.0x |
| Linear: 10 types   |    10 |   ~560ms |         26,504 |    1.7x |
| Linear: 50 types   |    50 |   ~734ms |         64,664 |    4.1x |
| Linear: 100 types  |   100 |   ~949ms |        112,364 |    7.1x |
| Branched: 4w x 3d  |    85 |   ~931ms |         89,893 |    5.7x |
| Branched: 2w x 6d  |   127 | ~1,111ms |        129,981 |    8.3x |
| Blockers: 8 steps  |    30 |   ~644ms |         46,927 |    3.0x |
| Blockers: 25 steps |    98 |   ~927ms |        143,759 |    9.1x |
| Loop: 20 steps     |    21 |   ~639ms |         39,730 |    2.5x |
| Loop: 50 steps     |    51 |   ~807ms |         72,460 |    4.6x |
| Merge: 2 x 50      |   100 |   ~924ms |        116,235 |    7.4x |
| Merge: 5 x 50      |   250 | ~1,439ms |        256,496 |   16.3x |
| Merge: 10 x 50     |   500 | ~2,202ms |        490,657 |   31.2x |
| Merge: 20 x 50     | 1,000 | ~3,780ms |        958,775 |   60.9x |
| Merge: 50 x 50     | 2,500 | ~8,941ms |      2,370,507 |  150.7x |

### Practical limits

| Configuration                              | Status            |
| ------------------------------------------ | ----------------- |
| Up to 100 types in a single linear chain   | OK, <1s (tsc)     |
| Branched chains up to 2w x 6d (~127 types) | OK, ~1.1s (tsc)   |
| Blockers: up to 25 steps, 3 blockers each  | OK, <1s (tsc)     |
| Loops: up to 50 self-referencing steps     | OK, <1s (tsc)     |
| Merging 10 slices of 50 types (500 total)  | OK, ~2.2s (tsc)   |
| Merging 50 slices of 50 types (2500 total) | OK, ~8.9s (tsc)   |

See [type-complexity](https://github.com/kvet/queuert/tree/main/benchmarks/type-complexity) for the full benchmark tool and detailed results.
