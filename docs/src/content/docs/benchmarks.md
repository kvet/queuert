---
title: Benchmarks
description: Processing capacity, memory footprint, query performance, and type complexity benchmarks for Queuert.
---

## Processing Capacity

Job throughput measured in two phases: creating chains (chains/s) and processing them to completion (jobs/s). Each adapter is exercised across four orthogonal modes — single vs. batched creation (`createChain` one at a time vs. `createChains` in batches of 100), and atomic vs. staged processing (see [Job Processing Modes](./guides/processing-modes/)). To avoid doubling the wall-clock, the four numbers are folded into two runs per adapter: atomic-process pairs with batched-create, staged-process pairs with single-create. The pairing is layout-only — create mode and process mode are independent in production. Each run uses 5,000 chains × concurrency 10, in its own child process for isolation (Node.js v22, Apple M1 Pro). State and notify are measured along separate axes — when one is varied, the other is held at the in-process default. PostgreSQL, Redis, and NATS run as Dockerized containers on macOS (Docker Desktop), so per-RTT latency includes the VM bridge — numbers reflect that environment rather than a host-native or production deployment.

The Create columns measure two ends of the realistic range: **single** is a tight `await client.createChain(...)` loop, dominated by per-call RTT (HTTP-handler-shaped traffic); **batched** is `client.createChains({ items: [...100] })`, amortizing transaction and notify overhead across the batch (bulk-enqueue / migration / replay traffic). Real workloads sit between the two depending on call shape and concurrency.

The Process columns measure how fast a single worker drains the queue once it's full. Atomic mode wraps each attempt in one transaction; staged mode adds an empty `prepare({ mode: "staged" })` round-trip before `complete`, isolating the pure cost of the second transaction without confounding with handler work. Steady-state deployment throughput is bounded by `min(create, process)`.

### State adapter (no notify)

| State adapter            | Create single (chains/s) | Create batched (chains/s) | Process atomic (jobs/s) | Process staged (jobs/s) |
| ------------------------ | -----------------------: | ------------------------: | ----------------------: | ----------------------: |
| In-process               |                  ~61,711 |                  ~180,586 |                 ~16,108 |                 ~11,232 |
| SQLite (better-sqlite3)  |                  ~26,738 |                   ~85,753 |                  ~9,558 |                  ~6,343 |
| SQLite (node:sqlite)     |                  ~23,944 |                   ~72,979 |                  ~9,156 |                  ~5,432 |
| PostgreSQL (postgres-js) |                   ~1,023 |                   ~26,004 |                  ~1,201 |                    ~999 |
| PostgreSQL (pg)          |                     ~896 |                   ~28,976 |                  ~1,397 |                  ~1,060 |

### Notify adapter (in-process state)

| Notify adapter           | Create single (chains/s) | Create batched (chains/s) | Process atomic (jobs/s) | Process staged (jobs/s) |
| ------------------------ | -----------------------: | ------------------------: | ----------------------: | ----------------------: |
| In-process               |                  ~56,858 |                  ~181,739 |                 ~15,835 |                 ~11,555 |
| Redis (redis)            |                   ~2,430 |                   ~78,715 |                  ~8,862 |                  ~6,096 |
| Redis (ioredis)          |                   ~1,893 |                   ~78,805 |                 ~10,370 |                  ~7,444 |
| PostgreSQL (pg)          |                   ~3,384 |                   ~71,303 |                  ~6,612 |                  ~5,423 |
| PostgreSQL (postgres-js) |                   ~4,067 |                   ~74,870 |                  ~7,419 |                  ~4,578 |
| NATS                     |                   ~3,918 |                  ~114,636 |                  ~9,921 |                  ~6,642 |

See [processing-capacity](https://github.com/kvet/queuert/tree/main/benchmarks/processing-capacity) for the full benchmark tool.

## Memory Footprint

Each adapter is exercised through a full lifecycle: build adapters → process 100 jobs → `close()`. A discarded warmup run beforehand stabilizes V8 JIT and lazy module loads (Node.js v22, Apple M1 Pro). Four numbers are reported, all measured against an infrastructure baseline taken after warmup. Snapshot-based, because `process.memoryUsage().heapUsed` significantly over-reports retention by including V8 fragmentation and code arena outside the live object graph.

- **Setup overhead** — heap allocated by all queuert pieces (state adapter, notify adapter, client, in-process worker) when fully built but before any jobs run.
- **In-flight peak** — heap during the processing of 100 concurrent jobs.
- **Live JS retained after close** — live-JS-object-graph delta from the infra baseline after `close()`. This is what answers "does queuert leak heap?".
- **JIT code retained after close** — V8-compiled instruction streams retained by the process. This is module-permanent (Node modules don't unload, so JIT'd functions stay), not a per-lifecycle leak. Reported separately so the picture is honest.

| Benchmark         | Setup overhead | In-flight peak | Live JS retained | JIT code retained |
| ----------------- | -------------: | -------------: | ---------------: | ----------------: |
| `notify-redis`    |         ~80 KB |        ~255 KB |           ~10 KB |            ~65 KB |
| `notify-postgres` |        ~545 KB |        ~705 KB |           ~10 KB |            ~35 KB |
| `notify-nats`     |        ~485 KB |        ~640 KB |           ~10 KB |            ~40 KB |
| `state-sqlite`    |        ~465 KB |        ~490 KB |           ~10 KB |            ~70 KB |
| `state-postgres`  |        ~510 KB |        ~760 KB |           ~20 KB |           ~180 KB |
| `dashboard`       |        ~610 KB |        ~795 KB |           ~10 KB |            ~85 KB |
| `otel`            |         ~45 KB |        ~240 KB |           ~10 KB |            ~85 KB |

The Live JS retained column is consistently ~10 KB across all adapters — that's V8 hidden classes and shape descriptors that persist from method invocations, not queuert state. The JIT code retained scales with adapter complexity: more SQL queries / driver code paths exercised → more functions JIT-compiled → more code retained. Both are one-time costs of _running_ the library in a process, not retention that grows per job or per lifecycle.

The driver/connection cost (e.g. node-redis client, postgres-js pool, NATS connection) lives outside queuert's lifecycle and is measured separately in the per-run output, not aggregated here.

See [memory-footprint](https://github.com/kvet/queuert/tree/main/benchmarks/memory-footprint) for the full measurement tool, methodology details, and per-step breakdowns.

## Type Complexity

Queuert's type-level machinery scales linearly across chain topologies. Measured on both TypeScript 6 (the last JS-based `tsc`, 6.0.2) and TypeScript 7 (the native compiler, 7.0.2), each scenario compiled against prebuilt `.d.mts` declarations (Node.js v22, Apple M1 Pro). Every scenario carries one attempt middleware so the baseline reflects a realistic client.

Instantiation counts are within ~1% across the two compilers — the metric is a property of the type system, not the implementation, so the scaling numbers below are portable. What changes is wall-clock: TypeScript 7 checks **~4–5× faster** across the board. The Instantiations and Scaling columns are TS 6 counts; TS 7 lands within a percent.

Every realistic topology stays comfortably fast — even a 2,500-type merge (50 slices × 50, far beyond typical usage) checks in ~7s on TS 6 and ~2.2s on TS 7.

### Type-check cost (TS 6 vs TS 7)

| Scenario           | Types | Instantiations | TS 6 time | TS 7 time | Scaling |
| ------------------ | ----: | -------------: | --------: | --------: | ------: |
| Linear: 1 type     |     1 |         27,205 |    ~471ms |     ~99ms |    1.0x |
| Linear: 10 types   |    10 |         37,687 |    ~509ms |    ~104ms |    1.4x |
| Linear: 50 types   |    50 |         83,007 |    ~650ms |    ~132ms |    3.1x |
| Linear: 100 types  |   100 |        139,657 |    ~846ms |    ~176ms |    5.1x |
| Branched: 4w x 3d  |    85 |        119,541 |    ~774ms |    ~165ms |    4.4x |
| Branched: 2w x 6d  |   127 |        167,583 |    ~922ms |    ~201ms |    6.2x |
| Blockers: 8 steps  |    30 |         64,144 |    ~584ms |    ~120ms |    2.4x |
| Blockers: 25 steps |    98 |        179,115 |    ~864ms |    ~183ms |    6.6x |
| Loop: 20 steps     |    21 |         52,385 |    ~550ms |    ~112ms |    1.9x |
| Loop: 50 steps     |    51 |         89,765 |    ~688ms |    ~136ms |    3.3x |
| Merge: 2 x 50      |   100 |        143,179 |    ~807ms |    ~183ms |    5.3x |
| Merge: 5 x 50      |   250 |        309,613 |  ~1,177ms |    ~271ms |   11.4x |
| Merge: 10 x 50     |   500 |        587,591 |  ~1,809ms |    ~439ms |   21.6x |
| Merge: 20 x 50     | 1,000 |      1,143,595 |  ~3,041ms |    ~814ms |   42.0x |
| Merge: 50 x 50     | 2,500 |      2,819,011 |  ~7,059ms |  ~2,170ms |  103.6x |

See [type-complexity](https://github.com/kvet/queuert/tree/main/benchmarks/type-complexity) for the full benchmark tool and detailed results.

## Query Performance

Per-query latency across state-adapter operations, measured on a seeded dataset (scale = 100). Each query is run 10 times; the table reports the p50 (median). PostgreSQL runs in a Dockerized container (Docker Desktop on macOS, pg driver); SQLite runs in-memory (better-sqlite3). Both adapters run `ANALYZE` after seeding so the query planner has accurate statistics. Node.js v22, Apple M1 Pro.

The benchmark covers every state-adapter method exercised in production: operational queries (the per-job CRUD path) and observability queries (the list/filter/paginate path used by dashboards and cleanup). The dataset is synthetic but covers all statuses, blocker topologies, and continuation chains to exercise the full query surface.

### Operational queries

| Query                            | PG p50 (ms) | SQLite p50 (ms) |
| -------------------------------- | ----------: | --------------: |
| getChains/default                |        1.07 |            0.18 |
| getChains/lock                   |        2.30 |            0.12 |
| getJobs/default                  |        0.90 |            0.06 |
| getJobs/lock                     |        2.12 |            0.10 |
| createJobs/default               |        2.95 |            0.13 |
| createJobs/deduplication         |        2.14 |            0.09 |
| continueJobs/default             |        2.09 |            0.27 |
| addJobsBlockers/default          |        3.34 |            0.18 |
| getJobBlockers/default           |        0.82 |            0.20 |
| unblockJobs/default              |        2.65 |            0.13 |
| startJobAttempt/default          |        1.84 |            0.11 |
| extendJobAttempt/default         |        1.15 |            0.05 |
| completeJobs/default             |        2.42 |            0.25 |
| reclaimExpiredJobAttempt/default |        1.75 |            0.11 |
| getStartAttemptDelayMs/default   |        1.52 |            0.04 |
| rescheduleJobs/default           |        1.51 |            0.11 |
| deleteChains/default             |        2.44 |            0.22 |

### Type discovery & counts

| Query                         | PG p50 (ms) | SQLite p50 (ms) |
| ----------------------------- | ----------: | --------------: |
| listChainTypeNames/default    |        0.75 |            0.06 |
| listJobTypeNames/default      |        0.74 |            0.06 |
| countByChainTypeNames/default |        2.34 |            1.18 |
| countByJobTypeNames/default   |        2.34 |            2.71 |

### List chains

| Query                                         | PG p50 (ms) | SQLite p50 (ms) |
| --------------------------------------------- | ----------: | --------------: |
| **No status filter**                          |             |                 |
| listChains/noStatus/default                   |       21.49 |            0.42 |
| listChains/noStatus/independent               |       52.52 |            0.52 |
| listChains/noStatus/nonIndependent            |       92.46 |          105.49 |
| listChains/noStatus/fromTo                    |       21.42 |            0.44 |
| listChains/noStatus/cursor                    |       49.21 |            0.80 |
| **Running**                                   |             |                 |
| listChains/running/default                    |        5.76 |            0.43 |
| listChains/running/independent                |      110.05 |            0.57 |
| listChains/running/nonIndependent             |       25.82 |           17.93 |
| listChains/running/cursor                     |       11.37 |            0.83 |
| **Completed**                                 |             |                 |
| listChains/completed/default                  |       11.30 |            0.43 |
| listChains/completed/independent              |       33.79 |            0.55 |
| listChains/completed/nonIndependent           |       51.76 |           44.13 |
| listChains/completed/orderByCreatedAt         |       12.65 |            0.47 |
| listChains/completed/orderByCompletedAt       |       10.59 |            0.47 |
| listChains/completed/cursor                   |       26.56 |            0.91 |
| listChains/completed/orderByCreatedAtCursor   |       25.15 |            0.86 |
| listChains/completed/orderByCompletedAtCursor |       25.25 |            0.85 |

### List jobs

| Query                                | PG p50 (ms) | SQLite p50 (ms) |
| ------------------------------------ | ----------: | --------------: |
| **No status filter**                 |             |                 |
| listJobs/noStatus/default            |       22.14 |            0.42 |
| listJobs/noStatus/fromTo             |       23.61 |            0.35 |
| listJobs/noStatus/cursor             |       22.48 |            0.66 |
| **Pending**                          |             |                 |
| listJobs/pending/default             |       21.73 |            0.34 |
| listJobs/pending/blocked             |       14.62 |           26.64 |
| listJobs/pending/unblocked           |       22.33 |            0.34 |
| listJobs/pending/fromTo              |       21.71 |            0.36 |
| listJobs/pending/orderByCreatedAt    |       23.71 |            0.34 |
| listJobs/pending/cursor              |       23.52 |            0.64 |
| **Running**                          |             |                 |
| listJobs/running/default             |        6.25 |            8.14 |
| listJobs/running/orderByCreatedAt    |        5.56 |            0.38 |
| listJobs/running/orderByAttemptUntil |        5.39 |            0.36 |
| listJobs/running/cursor              |        9.79 |           12.89 |
| **Completed**                        |             |                 |
| listJobs/completed/default           |       11.75 |            0.35 |
| listJobs/completed/orderByCreatedAt  |       11.09 |            0.34 |
| listJobs/completed/cursor            |       12.54 |            0.71 |

### List chain jobs & blocked jobs

| Query                   | PG p50 (ms) | SQLite p50 (ms) |
| ----------------------- | ----------: | --------------: |
| listChainJobs/default   |        2.23 |            0.42 |
| listChainJobs/cursor    |        4.13 |            0.88 |
| listBlockedJobs/default |      182.94 |          188.92 |
| listBlockedJobs/cursor  |      350.43 |          380.03 |

See [query-performance](https://github.com/kvet/queuert/tree/main/benchmarks/query-performance) for the full benchmark tool, query plans, and per-adapter EXPLAIN output.
