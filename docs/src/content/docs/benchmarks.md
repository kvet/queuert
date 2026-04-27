---
title: Benchmarks
description: Processing capacity, memory footprint, and type complexity benchmarks for Queuert.
---

## Processing Capacity

End-to-end job throughput measured in two phases: starting job chains (chains/s) and processing them to completion (jobs/s). Each adapter runs in a separate child process for isolation (Node.js v22, 10,000 jobs, concurrency 10, Apple M1 Pro). State and notify are measured along separate axes — when one is varied, the other is held at the in-process default. PostgreSQL, Redis, and NATS run as Dockerized containers on macOS (Docker Desktop), so per-RTT latency includes the VM bridge — numbers reflect that environment rather than a host-native or production deployment.

### State adapter (no notify)

| State adapter | Start (chains/s) | Process (jobs/s) | End-to-end (jobs/s) |
| ------------- | ---------------: | ---------------: | ------------------: |
| In-process    |          ~81,312 |          ~18,581 |             ~15,125 |
| SQLite        |          ~11,629 |           ~4,843 |              ~3,419 |
| PostgreSQL    |             ~380 |             ~514 |                ~218 |

### Notify adapter (in-process state)

| Notify adapter | Start (chains/s) | Process (jobs/s) | End-to-end (jobs/s) |
| -------------- | ---------------: | ---------------: | ------------------: |
| In-process     |          ~55,405 |          ~11,667 |              ~9,638 |
| Redis          |           ~2,846 |          ~11,074 |              ~2,264 |
| PostgreSQL     |           ~2,706 |           ~6,700 |              ~1,927 |
| NATS           |           ~1,849 |           ~4,524 |              ~1,313 |

See [processing-capacity](https://github.com/kvet/queuert/tree/main/benchmarks/processing-capacity) for the full benchmark tool.

## Memory Footprint

Each adapter is exercised through a full lifecycle: build adapters → process 100 jobs → `close()`. A discarded warmup run beforehand stabilizes V8 JIT and lazy module loads (Node.js v22, Apple M1 Pro). Four numbers are reported, all measured against an infrastructure baseline taken after warmup. Snapshot-based, because `process.memoryUsage().heapUsed` significantly over-reports retention by including V8 fragmentation and code arena outside the live object graph.

- **Setup overhead** — heap allocated by all queuert pieces (state adapter, notify adapter, client, in-process worker) when fully built but before any jobs run.
- **In-flight peak** — heap during the processing of 100 concurrent jobs.
- **Live JS retained after close** — live-JS-object-graph delta from the infra baseline after `close()`. This is what answers "does queuert leak heap?".
- **JIT code retained after close** — V8-compiled instruction streams retained by the process. This is module-permanent (Node modules don't unload, so JIT'd functions stay), not a per-lifecycle leak. Reported separately so the picture is honest.

| Benchmark         | Setup overhead | In-flight peak | Live JS retained | JIT code retained |
| ----------------- | -------------: | -------------: | ---------------: | ----------------: |
| `notify-redis`    |         ~80 KB |        ~260 KB |           ~10 KB |            ~65 KB |
| `notify-postgres` |        ~550 KB |        ~715 KB |           ~10 KB |            ~35 KB |
| `notify-nats`     |        ~490 KB |        ~645 KB |           ~10 KB |            ~45 KB |
| `state-sqlite`    |        ~465 KB |        ~495 KB |           ~10 KB |            ~70 KB |
| `state-postgres`  |        ~510 KB |        ~795 KB |           ~30 KB |           ~195 KB |
| `dashboard`       |        ~605 KB |        ~800 KB |           ~10 KB |            ~80 KB |
| `otel`            |         ~40 KB |        ~235 KB |           ~10 KB |            ~85 KB |

The Live JS retained column is consistently ~10 KB across all adapters — that's V8 hidden classes and shape descriptors that persist from method invocations, not queuert state. The JIT code retained scales with adapter complexity: more SQL queries / driver code paths exercised → more functions JIT-compiled → more code retained. Both are one-time costs of _running_ the library in a process, not retention that grows per job or per lifecycle.

The driver/connection cost (e.g. node-redis client, postgres-js pool, NATS connection) lives outside queuert's lifecycle and is measured separately in the per-run output, not aggregated here.

See [memory-footprint](https://github.com/kvet/queuert/tree/main/benchmarks/memory-footprint) for the full measurement tool, methodology details, and per-step breakdowns.

## Type Complexity

Queuert's type-level machinery scales linearly across chain topologies (prebuilt `.d.mts`, Node.js v22, Apple M1 Pro):

### tsc (6.0.2)

| Scenario           | Types |     Time | Instantiations | Scaling |
| ------------------ | ----: | -------: | -------------: | ------: |
| Linear: 1 type     |     1 |   ~636ms |         20,764 |    1.0x |
| Linear: 10 types   |    10 |   ~763ms |         30,601 |    1.5x |
| Linear: 50 types   |    50 |   ~877ms |         72,201 |    3.5x |
| Linear: 100 types  |   100 | ~1,148ms |        124,201 |    6.0x |
| Branched: 4w x 3d  |    85 |   ~970ms |        104,976 |    5.1x |
| Branched: 2w x 6d  |   127 | ~1,137ms |        148,676 |    7.2x |
| Blockers: 8 steps  |    30 |   ~642ms |         54,256 |    2.6x |
| Blockers: 25 steps |    98 |   ~907ms |        160,608 |    7.7x |
| Loop: 20 steps     |    21 |   ~596ms |         44,774 |    2.2x |
| Loop: 50 steps     |    51 |   ~787ms |         80,084 |    3.9x |
| Merge: 2 x 50      |   100 |   ~937ms |        128,362 |    6.2x |
| Merge: 5 x 50      |   250 | ~1,270ms |        281,694 |   13.6x |
| Merge: 10 x 50     |   500 | ~1,948ms |        537,524 |   25.9x |
| Merge: 20 x 50     | 1,000 | ~3,386ms |      1,049,289 |   50.5x |
| Merge: 50 x 50     | 2,500 | ~7,999ms |      2,589,674 |  124.7x |

### Practical limits

| Configuration                              | Status          |
| ------------------------------------------ | --------------- |
| Up to 100 types in a single linear chain   | OK, ~1.1s (tsc) |
| Branched chains up to 2w x 6d (~127 types) | OK, ~1.1s (tsc) |
| Blockers: up to 25 steps, 3 blockers each  | OK, <1s (tsc)   |
| Loops: up to 50 self-referencing steps     | OK, <1s (tsc)   |
| Merging 10 slices of 50 types (500 total)  | OK, ~1.9s (tsc) |
| Merging 50 slices of 50 types (2500 total) | OK, ~8.0s (tsc) |

See [type-complexity](https://github.com/kvet/queuert/tree/main/benchmarks/type-complexity) for the full benchmark tool and detailed results.
