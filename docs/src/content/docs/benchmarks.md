---
title: Benchmarks
description: Processing capacity, memory footprint, query performance, and type complexity benchmarks for Queuert.
---

## Processing Capacity

Job throughput measured in two phases: creating chains (chains/s) and processing them to completion (jobs/s). Each adapter is exercised across four orthogonal modes — single vs. batched creation (`createChain` one at a time vs. `createChains` in batches of 100), and atomic vs. staged processing (see [Job Processing Modes](/queuert/guides/processing-modes/)). To avoid doubling the wall-clock, the four numbers are folded into two runs per adapter: atomic-process pairs with batched-create, staged-process pairs with single-create. The pairing is layout-only — create mode and process mode are independent in production. Each run uses 5,000 chains × concurrency 10, in its own child process for isolation (Node.js v22, Apple M1 Pro). State and notify are measured along separate axes — when one is varied, the other is held at the in-process default. PostgreSQL, Redis, and NATS run as Dockerized containers on macOS (Docker Desktop), so per-RTT latency includes the VM bridge — numbers reflect that environment rather than a host-native or production deployment.

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

Instantiation counts are within ~1% across the two compilers — the metric is a property of the type system, not the implementation, so the scaling numbers below are portable. What changes is wall-clock: TypeScript 7 checks **~5× faster** for typical topologies, tapering to ~4× on the largest merges. The Instantiations and Scaling columns are TS 6 counts; TS 7 lands within a percent.

Every realistic topology stays comfortably fast — even a 2,500-type merge (50 slices × 50, far beyond typical usage) checks in ~5.7s on TS 6 and ~1.5s on TS 7. Attempt middleware adds little: going from 1 to 10 middlewares on a 100-type chain adds ~9% instantiations.

### Type-check cost (TS 6 vs TS 7)

| Scenario                     | Types | Instantiations | TS 6 time | TS 7 time | Scaling |
| ---------------------------- | ----: | -------------: | --------: | --------: | ------: |
| Linear: 1 type               |     1 |         19,467 |    ~573ms |    ~117ms |    1.0x |
| Linear: 10 types             |    10 |         25,544 |    ~590ms |    ~119ms |    1.3x |
| Linear: 50 types             |    50 |         52,184 |    ~704ms |    ~137ms |    2.7x |
| Linear: 100 types            |   100 |         85,484 |    ~906ms |    ~165ms |    4.4x |
| Branched: 4w x 3d            |    85 |         75,923 |    ~854ms |    ~153ms |    3.9x |
| Branched: 2w x 6d            |   127 |        104,105 |    ~971ms |    ~173ms |    5.3x |
| Blockers: 8 steps            |    30 |         47,240 |    ~707ms |    ~134ms |    2.4x |
| Blockers: 25 steps           |    98 |        140,859 |    ~942ms |    ~183ms |    7.2x |
| Loop: 20 steps               |    21 |         33,422 |    ~625ms |    ~122ms |    1.7x |
| Loop: 50 steps               |    51 |         53,792 |    ~716ms |    ~144ms |    2.8x |
| Merge: 2 x 50                |   100 |         89,769 |    ~842ms |    ~160ms |    4.6x |
| Merge: 5 x 50                |   250 |        188,664 |  ~1,158ms |    ~226ms |    9.7x |
| Merge: 10 x 50               |   500 |        354,077 |  ~1,681ms |    ~337ms |   18.2x |
| Merge: 20 x 50               | 1,000 |        684,951 |  ~2,634ms |    ~585ms |   35.2x |
| Merge: 50 x 50               | 2,500 |      1,684,977 |  ~5,671ms |  ~1,482ms |   86.6x |
| Middleware: 10 on linear-100 |   100 |         93,339 |    ~913ms |    ~174ms |    4.8x |

See [type-complexity](https://github.com/kvet/queuert/tree/main/benchmarks/type-complexity) for the full benchmark tool and detailed results.

## Query Performance

Per-query latency across state-adapter operations, measured on a seeded dataset (scale = 100). Each query is run 10 times; the table reports the p50 (median). PostgreSQL runs in a Dockerized container (Docker Desktop on macOS, pg driver); SQLite runs in-memory (better-sqlite3). Both adapters run `ANALYZE` after seeding so the query planner has accurate statistics. Node.js v22, Apple M1 Pro.

The benchmark covers every state-adapter method exercised in production: operational queries (the per-job CRUD path) and observability queries (the list/filter/paginate path used by dashboards and cleanup). The dataset is synthetic but covers all statuses, blocker topologies, and continuation chains to exercise the full query surface.

### Operational queries

| Query                            | PG p50 (ms) | SQLite p50 (ms) |
| -------------------------------- | ----------: | --------------: |
| getChains/default                |        1.48 |            0.25 |
| getChains/lock                   |        1.42 |            0.24 |
| getJobs/default                  |        0.74 |            0.11 |
| getJobs/lock                     |        2.06 |            0.14 |
| createJobs/default               |        2.94 |            0.26 |
| createJobs/deduplication         |        2.42 |            0.13 |
| continueJobs/default             |        3.39 |            0.42 |
| addJobsBlockers/default          |        2.90 |            0.20 |
| getJobBlockers/default           |        0.79 |            0.20 |
| unblockJobs/default              |        2.74 |            0.30 |
| startJobAttempt/default          |        1.64 |            0.24 |
| extendJobAttempt/default         |        1.56 |            0.12 |
| completeJobs/default             |        2.17 |            0.31 |
| reclaimExpiredJobAttempt/default |        1.67 |            0.12 |
| getStartAttemptDelayMs/default   |        1.57 |            0.05 |
| rescheduleJobs/default           |        2.14 |            0.21 |
| deleteChains/default             |        4.73 |            0.27 |

### Type discovery & counts

| Query                         | PG p50 (ms) | SQLite p50 (ms) |
| ----------------------------- | ----------: | --------------: |
| listChainTypeNames/default    |        0.93 |            0.06 |
| listJobTypeNames/default      |        0.82 |            0.06 |
| countByChainTypeNames/default |        2.23 |            0.99 |
| countByJobTypeNames/default   |        2.59 |            1.02 |

### List chains

| Query                                         | PG p50 (ms) | SQLite p50 (ms) |
| --------------------------------------------- | ----------: | --------------: |
| **No status filter**                          |             |                 |
| listChains/noStatus/default                   |       21.38 |            0.45 |
| listChains/noStatus/independent               |       57.81 |            0.54 |
| listChains/noStatus/nonIndependent            |       75.17 |          100.88 |
| listChains/noStatus/fromTo                    |       21.06 |            0.51 |
| listChains/noStatus/cursor                    |       47.63 |            0.86 |
| **Running**                                   |             |                 |
| listChains/running/default                    |        5.80 |            0.58 |
| listChains/running/independent                |      106.22 |            0.89 |
| listChains/running/nonIndependent             |       23.99 |           19.15 |
| listChains/running/cursor                     |       11.40 |            0.92 |
| **Completed**                                 |             |                 |
| listChains/completed/default                  |       12.38 |            0.48 |
| listChains/completed/independent              |       36.71 |            0.64 |
| listChains/completed/nonIndependent           |       54.39 |           40.25 |
| listChains/completed/orderByCreatedAt         |       13.74 |            0.45 |
| listChains/completed/orderByCompletedAt       |       11.68 |            0.47 |
| listChains/completed/cursor                   |       26.53 |            0.88 |
| listChains/completed/orderByCreatedAtCursor   |       28.57 |            0.89 |
| listChains/completed/orderByCompletedAtCursor |       26.21 |            0.90 |

### List jobs

The `blocked` status listing has its own partial index (`job_blocked_idx`), which both adapters use to satisfy the filter and the scheduled-at ordering, so it lands in the same range as the `pending` listing.

| Query                                | PG p50 (ms) | SQLite p50 (ms) |
| ------------------------------------ | ----------: | --------------: |
| **No status filter**                 |             |                 |
| listJobs/noStatus/default            |       20.60 |            0.40 |
| listJobs/noStatus/fromTo             |       21.94 |            0.45 |
| listJobs/noStatus/cursor             |       21.55 |            0.68 |
| **Pending**                          |             |                 |
| listJobs/pending/default             |       22.13 |            0.36 |
| listJobs/pending/fromTo              |       21.36 |            0.40 |
| listJobs/pending/orderByCreatedAt    |       26.01 |            0.36 |
| listJobs/pending/cursor              |       21.87 |            0.67 |
| **Blocked**                          |             |                 |
| listJobs/blocked/default             |       15.56 |            0.52 |
| listJobs/blocked/orderByCreatedAt    |       19.56 |            0.52 |
| listJobs/blocked/cursor              |       24.54 |            0.73 |
| **Running**                          |             |                 |
| listJobs/running/default             |        7.08 |            8.45 |
| listJobs/running/orderByCreatedAt    |        6.44 |            0.41 |
| listJobs/running/orderByAttemptUntil |        5.46 |            0.43 |
| listJobs/running/cursor              |        8.86 |           12.60 |
| **Completed**                        |             |                 |
| listJobs/completed/default           |       12.66 |            0.57 |
| listJobs/completed/orderByCreatedAt  |       13.62 |            0.40 |
| listJobs/completed/cursor            |       13.27 |            0.72 |

### List chain jobs & blocked jobs

| Query                   | PG p50 (ms) | SQLite p50 (ms) |
| ----------------------- | ----------: | --------------: |
| listChainJobs/default   |        2.51 |            0.47 |
| listChainJobs/cursor    |        5.37 |            0.97 |
| listBlockedJobs/default |      172.66 |          192.68 |
| listBlockedJobs/cursor  |      326.74 |          382.81 |

See [query-performance](https://github.com/kvet/queuert/tree/main/benchmarks/query-performance) for the full benchmark tool, query plans, and per-adapter EXPLAIN output.
