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
| In-process               |                  ~68,646 |                  ~193,754 |                 ~17,881 |                 ~12,569 |
| SQLite (better-sqlite3)  |                  ~23,336 |                   ~63,425 |                  ~9,529 |                  ~6,410 |
| SQLite (node:sqlite)     |                  ~21,845 |                   ~58,265 |                  ~8,645 |                  ~5,612 |
| PostgreSQL (postgres-js) |                     ~795 |                   ~18,916 |                  ~1,188 |                    ~962 |
| PostgreSQL (pg)          |                     ~791 |                   ~21,304 |                  ~1,230 |                    ~900 |

### Notify adapter (in-process state)

| Notify adapter           | Create single (chains/s) | Create batched (chains/s) | Process atomic (jobs/s) | Process staged (jobs/s) |
| ------------------------ | -----------------------: | ------------------------: | ----------------------: | ----------------------: |
| In-process               |                  ~61,850 |                  ~187,567 |                 ~16,992 |                 ~12,388 |
| Redis (redis)            |                   ~2,516 |                   ~89,277 |                  ~9,825 |                  ~6,266 |
| Redis (ioredis)          |                   ~2,524 |                   ~78,775 |                 ~11,462 |                  ~7,889 |
| PostgreSQL (pg)          |                   ~3,893 |                   ~71,690 |                  ~7,833 |                  ~5,684 |
| PostgreSQL (postgres-js) |                   ~4,232 |                   ~88,970 |                  ~7,964 |                  ~4,608 |
| NATS                     |                   ~4,152 |                  ~117,277 |                 ~10,787 |                  ~6,470 |

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

Single-job operations on the hot path — acquiring, extending, and finishing attempts. All sub-5 ms on PostgreSQL, sub-1 ms on SQLite.

| Query                            | PG p50 (ms) | SQLite p50 (ms) |
| -------------------------------- | ----------: | --------------: |
| getChains/default                |        1.22 |            0.13 |
| getChains/lock                   |        1.98 |            0.74 |
| getJobs/default                  |        0.96 |            0.06 |
| getJobs/lock                     |        2.46 |            0.08 |
| createChains/default             |        3.73 |            0.31 |
| createChains/deduplication       |        2.33 |            0.05 |
| createContinuationJob/default    |        2.11 |            0.12 |
| addJobsBlockers/default          |        9.24 |            0.13 |
| getJobBlockers/default           |        1.15 |            0.15 |
| unblockJobs/default              |        2.93 |            0.12 |
| startJobAttempt/default          |        1.53 |            0.06 |
| extendJobAttempt/default         |        0.96 |            0.04 |
| finishJobAttempt/failure         |        1.05 |            0.05 |
| finishJobAttempt/success         |        0.85 |            0.08 |
| reclaimExpiredJobAttempt/default |        1.99 |            0.07 |
| getStartAttemptDelayMs/default   |        1.23 |            0.03 |
| rescheduleJobs/default           |        0.79 |            0.06 |
| deleteChains/default             |        2.47 |            0.17 |
| deleteChains/cascade             |        3.62 |            0.06 |

### List jobs

Paginated job listing with filter combinations. Unfiltered and ID-based lookups are fast; filtering by `typeName` or `chainTypeName` without a status constraint is the most expensive pattern.

| Query                                   | PG p50 (ms) | SQLite p50 (ms) |
| --------------------------------------- | ----------: | --------------: |
| **No status filter**                    |             |                 |
| listJobs/noStatus/default               |        1.18 |            0.24 |
| listJobs/noStatus/typeName              |      305.86 |          194.83 |
| listJobs/noStatus/chainTypeName         |      288.85 |          195.39 |
| listJobs/noStatus/chainId               |       41.14 |            1.32 |
| listJobs/noStatus/jobId                 |        0.83 |            0.09 |
| listJobs/noStatus/fromTo                |        0.90 |            0.15 |
| listJobs/noStatus/cursor                |        1.75 |            0.24 |
| **Pending**                             |             |                 |
| listJobs/pending/default                |        1.46 |            0.22 |
| listJobs/pending/blocked                |       16.36 |           20.45 |
| listJobs/pending/unblocked              |        2.01 |            0.23 |
| listJobs/pending/typeName               |      233.55 |          158.66 |
| listJobs/pending/typeNameBlocked        |       67.59 |          186.52 |
| listJobs/pending/typeNameUnblocked      |      269.17 |           47.75 |
| listJobs/pending/chainTypeName          |      251.63 |          161.27 |
| listJobs/pending/fromTo                 |        2.01 |            0.24 |
| listJobs/pending/orderByCreatedAt       |        0.99 |            0.13 |
| listJobs/pending/cursor                 |        6.31 |            0.51 |
| **Running**                             |             |                 |
| listJobs/running/default                |       20.92 |           14.47 |
| listJobs/running/typeName               |        9.09 |            7.35 |
| listJobs/running/chainTypeName          |       14.15 |           10.86 |
| listJobs/running/orderByCreatedAt       |        3.86 |           14.67 |
| listJobs/running/orderByAttemptUntil    |        1.86 |           15.02 |
| listJobs/running/cursor                 |       40.54 |           23.21 |
| **Completed**                           |             |                 |
| listJobs/completed/default              |        1.04 |            0.14 |
| listJobs/completed/typeName             |       32.86 |           12.20 |
| listJobs/completed/chainTypeName        |       32.77 |           12.58 |
| listJobs/completed/continued            |        1.55 |            0.88 |
| listJobs/completed/notContinued         |       20.95 |            0.58 |
| listJobs/completed/typeNameContinued    |        4.20 |            0.77 |
| listJobs/completed/typeNameNotContinued |       32.04 |           13.71 |
| listJobs/completed/orderByCreatedAt     |       43.41 |           35.47 |
| listJobs/completed/cursor               |        2.05 |            0.25 |

### List chains

Paginated chain listing. The `typeName` filter and `nonIndependent` (chains with blockers) are consistently slower due to the join surface. `orderByCreatedAt` on completed chains is the single most expensive query — over 1 s on both adapters at this scale.

| Query                                         | PG p50 (ms) | SQLite p50 (ms) |
| --------------------------------------------- | ----------: | --------------: |
| **No status filter**                          |             |                 |
| listChains/noStatus/default                   |       16.11 |            0.37 |
| listChains/noStatus/typeName                  |      161.10 |          208.07 |
| listChains/noStatus/independent               |       16.87 |            0.42 |
| listChains/noStatus/nonIndependent            |       18.74 |            5.43 |
| listChains/noStatus/typeNameIndependent       |      161.71 |          206.88 |
| listChains/noStatus/typeNameNonIndependent    |      203.74 |          504.20 |
| listChains/noStatus/fromTo                    |       16.95 |            0.32 |
| listChains/noStatus/chainId                   |      244.19 |            0.19 |
| listChains/noStatus/cursor                    |       33.08 |            0.73 |
| **Running**                                   |             |                 |
| listChains/running/default                    |       17.38 |            0.29 |
| listChains/running/typeName                   |      129.85 |          126.29 |
| listChains/running/independent                |       16.14 |            0.29 |
| listChains/running/nonIndependent             |       19.30 |            4.53 |
| listChains/running/typeNameIndependent        |      119.53 |          126.03 |
| listChains/running/typeNameNonIndependent     |      125.26 |          266.54 |
| listChains/running/cursor                     |       31.97 |            0.77 |
| **Completed**                                 |             |                 |
| listChains/completed/default                  |       62.21 |            1.17 |
| listChains/completed/typeName                 |      171.48 |           81.58 |
| listChains/completed/independent              |       61.17 |            1.05 |
| listChains/completed/nonIndependent           |      218.32 |          220.48 |
| listChains/completed/typeNameIndependent      |      170.45 |           73.70 |
| listChains/completed/typeNameNonIndependent   |       88.73 |          199.74 |
| listChains/completed/orderByCreatedAt         |    1,078.85 |          645.97 |
| listChains/completed/orderByCompletedAt       |       60.67 |            0.90 |
| listChains/completed/cursor                   |      123.64 |            1.10 |
| listChains/completed/orderByCreatedAtCursor   |    1,088.98 |        1,256.21 |
| listChains/completed/orderByCompletedAtCursor |      124.03 |            1.31 |

### List chain jobs & blocked jobs

| Query                   | PG p50 (ms) | SQLite p50 (ms) |
| ----------------------- | ----------: | --------------: |
| listChainJobs/default   |        1.07 |            0.13 |
| listChainJobs/cursor    |        2.69 |            0.28 |
| listBlockedJobs/default |       44.56 |          192.71 |
| listBlockedJobs/cursor  |      501.43 |          387.87 |

See [query-performance](https://github.com/kvet/queuert/tree/main/benchmarks/query-performance) for the full benchmark tool, query plans, and per-adapter EXPLAIN output.
