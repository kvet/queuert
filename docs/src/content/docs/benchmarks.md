---
title: Benchmarks
description: Processing capacity, memory footprint, and type complexity benchmarks for Queuert.
---

## Processing Capacity

End-to-end job throughput measured in two phases: starting job chains (chains/s) and processing them to completion (jobs/s). Each adapter combination runs in a separate child process for isolation (Node.js v22, 10,000 jobs, concurrency 10).

| State      | Notify     | Start (chains/s) | Process (jobs/s) | End-to-end (jobs/s) |
| ---------- | ---------- | ---------------: | ---------------: | ------------------: |
| PostgreSQL | in-process |             ~630 |             ~375 |                ~235 |
| PostgreSQL | PostgreSQL |             ~506 |             ~396 |                ~222 |
| SQLite     | in-process |          ~14,600 |             ~793 |                ~752 |
| SQLite     | Redis      |           ~2,680 |             ~555 |                ~460 |
| SQLite     | NATS       |          ~11,560 |             ~789 |                ~739 |

See [processing-capacity](https://github.com/kvet/queuert/tree/main/benchmarks/processing-capacity) for the full benchmark tool.

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

See [memory-footprint](https://github.com/kvet/queuert/tree/main/benchmarks/memory-footprint) for the full measurement tool.

## Type Complexity

Queuert's type-level machinery scales linearly across chain topologies (prebuilt `.d.mts`):

### tsc (5.9.3)

| Scenario           | Types |     Time | Instantiations | Memory | Scaling |
| ------------------ | ----: | -------: | -------------: | -----: | ------: |
| Linear: 1 type     |     1 |   ~600ms |         21,409 |  114MB |    1.0x |
| Linear: 10 types   |    10 |   ~680ms |         30,469 |  117MB |    1.4x |
| Linear: 50 types   |    50 |   ~760ms |         70,669 |  129MB |    3.3x |
| Linear: 100 types  |   100 |   ~910ms |        120,919 |  144MB |    5.6x |
| Branched: 4w x 3d  |    85 |   ~880ms |         97,825 |  149MB |    4.6x |
| Branched: 2w x 6d  |   127 | ~1,030ms |        140,087 |  160MB |    6.5x |
| Blockers: 8 steps  |    30 |   ~540ms |         50,760 |  124MB |    2.4x |
| Blockers: 25 steps |    98 |   ~780ms |        148,255 |  151MB |    6.9x |
| Loop: 20 steps     |    21 |   ~550ms |         44,266 |  124MB |    2.1x |
| Loop: 50 steps     |    51 |   ~700ms |         78,526 |  138MB |    3.7x |
| Merge: 2 x 50      |   100 |   ~790ms |        122,653 |  149MB |    5.7x |
| Merge: 5 x 50      |   250 | ~1,200ms |        264,105 |  181MB |   12.3x |
| Merge: 10 x 50     |   500 | ~1,840ms |        500,251 |  254MB |   23.4x |
| Merge: 20 x 50     | 1,000 | ~3,140ms |        972,339 |  417MB |   45.4x |
| Merge: 50 x 50     | 2,500 | ~7,280ms |      2,395,981 |  938MB |  111.9x |

### Practical limits

| Configuration                              | Status            |
| ------------------------------------------ | ----------------- |
| Up to 100 types in a single linear chain   | OK, <1s (tsc)     |
| Branched chains up to 2w x 6d (~127 types) | OK, ~1s (tsc)     |
| Blockers: up to 25 steps, 3 blockers each  | OK, <1s (tsc)     |
| Loops: up to 50 self-referencing steps     | OK, <1s (tsc)     |
| Merging 10 slices of 50 types (500 total)  | OK, ~1.8s (tsc)   |
| Merging 50 slices of 50 types (2500 total) | OK, ~7.3s (tsc)   |

See [type-complexity](https://github.com/kvet/queuert/tree/main/benchmarks/type-complexity) for the full benchmark tool and detailed results.
