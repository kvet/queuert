---
title: Benchmarks
description: Processing capacity, memory footprint, query performance, and type complexity benchmarks for Queuert.
---

## Processing Capacity

Job throughput across five scenarios per adapter, each in its own child process (Node.js v22, Apple M1 Pro). Every scenario measures a fixed 2 s window, and every completion scenario starts from the same seeded queue of 40,000 jobs, so only concurrency varies between columns. State and notify are measured along separate axes: when one is varied, the other is held at the in-process default. PostgreSQL, Redis, and NATS run as Dockerized containers on macOS (Docker Desktop), so per-RTT latency includes the VM bridge — numbers reflect that environment rather than a host-native or production deployment.

- **Creation** — a tight `client.createChain(...)` loop, one transaction per chain (_Single_), and `client.createChains` with 100 items per transaction (_Batched_). Single creation is dominated by per-call RTT (HTTP-handler-shaped traffic); batched creation amortizes transaction and notify overhead (bulk-enqueue traffic).
- **Completion, no-op handler** — how fast one worker drains the queue when the handler only opens its own transaction and calls `complete` in it. The multiplier is the worker concurrency: x1 measures each job's full round-trip (acquire, then `complete` and commit) back to back, and higher levels show how far parallel slots scale it.

Steady-state deployment throughput is bounded by `min(create, complete)`. The in-process state adapter keeps its indexes in sorted arrays, so its completion rates fall with queue depth; at 40,000 queued jobs that cost, not the worker, bounds every row that uses in-process state, including the whole notify axis.

### Creation (chains/s)

| Adapter                               |  Single | Batched (100) |
| ------------------------------------- | ------: | ------------: |
| **State adapter (in-process notify)** |         |               |
| In-process                            | ~88,585 |      ~205,063 |
| SQLite (better-sqlite3)               | ~28,644 |       ~88,850 |
| SQLite (node:sqlite)                  | ~23,446 |       ~77,073 |
| PostgreSQL (postgres-js)              |    ~870 |       ~30,241 |
| PostgreSQL (pg)                       |    ~827 |       ~28,415 |
| **Notify adapter (in-process state)** |         |               |
| In-process                            | ~81,548 |      ~186,412 |
| Redis (redis)                         |  ~1,275 |       ~79,267 |
| Redis (ioredis)                       |  ~2,340 |      ~100,197 |
| PostgreSQL (pg)                       |  ~3,879 |      ~116,092 |
| PostgreSQL (postgres-js)              |  ~4,456 |      ~122,082 |
| NATS                                  |  ~4,375 |      ~130,000 |

### Completion, no-op handler (jobs/s)

| Adapter                               |     x1 |     x4 |    x16 |
| ------------------------------------- | -----: | -----: | -----: |
| **State adapter (in-process notify)** |        |        |        |
| In-process                            | ~4,996 | ~5,143 | ~5,389 |
| SQLite (better-sqlite3)               | ~4,700 | ~5,328 | ~7,461 |
| SQLite (node:sqlite)                  | ~3,994 | ~5,475 | ~7,994 |
| PostgreSQL (postgres-js)              |   ~367 |   ~853 | ~1,738 |
| PostgreSQL (pg)                       |   ~333 | ~1,127 | ~2,327 |
| **Notify adapter (in-process state)** |        |        |        |
| In-process                            | ~4,863 | ~4,509 | ~4,797 |
| Redis (redis)                         |   ~865 | ~2,067 | ~3,504 |
| Redis (ioredis)                       | ~1,018 | ~3,987 | ~4,139 |
| PostgreSQL (pg)                       |   ~964 | ~3,646 | ~3,719 |
| PostgreSQL (postgres-js)              |   ~992 | ~3,505 | ~3,537 |
| NATS                                  | ~1,861 | ~4,060 | ~4,111 |

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
| `notify-postgres` |        ~500 KB |        ~680 KB |           ~10 KB |            ~75 KB |
| `notify-nats`     |        ~435 KB |        ~570 KB |           ~10 KB |            ~45 KB |
| `state-sqlite`    |        ~485 KB |        ~560 KB |           ~10 KB |           ~105 KB |
| `state-postgres`  |        ~470 KB |        ~620 KB |           ~25 KB |           ~105 KB |
| `dashboard`       |        ~665 KB |        ~835 KB |           ~10 KB |           ~100 KB |
| `otel`            |         ~65 KB |        ~240 KB |           ~10 KB |           ~110 KB |

The Live JS retained column stays at ~10–25 KB across all adapters — that's V8 hidden classes and shape descriptors that persist from method invocations, not queuert state. The JIT code retained scales with adapter complexity: more SQL queries / driver code paths exercised → more functions JIT-compiled → more code retained. Both are one-time costs of _running_ the library in a process, not retention that grows per job or per lifecycle.

The driver/connection cost (e.g. node-redis client, postgres-js pool, NATS connection) lives outside queuert's lifecycle and is measured separately in the per-run output, not aggregated here.

See [memory-footprint](https://github.com/kvet/queuert/tree/main/benchmarks/memory-footprint) for the full measurement tool, methodology details, and per-step breakdowns.

## Type Complexity

Queuert's type-level machinery scales linearly across chain topologies. Measured on both TypeScript 6 (the last JS-based `tsc`, 6.0.2) and TypeScript 7 (the native compiler, 7.0.2), each scenario compiled against prebuilt `.d.mts` declarations (Node.js v22, Apple M1 Pro). Every scenario carries one attempt middleware so the baseline reflects a realistic client.

### Type-check cost (TS 6 vs TS 7)

| Scenario                     | Types | Instantiations | TS 6 time | TS 7 time | Scaling |
| ---------------------------- | ----: | -------------: | --------: | --------: | ------: |
| Linear: 1 type               |     1 |         17,191 |    ~527ms |    ~112ms |    1.0x |
| Linear: 10 types             |    10 |         22,010 |    ~561ms |    ~113ms |    1.3x |
| Linear: 50 types             |    50 |         43,450 |    ~682ms |    ~131ms |    2.5x |
| Linear: 100 types            |   100 |         70,250 |    ~771ms |    ~163ms |    4.1x |
| Branched: 4w x 3d            |    85 |         62,639 |    ~784ms |    ~152ms |    3.6x |
| Branched: 2w x 6d            |   127 |         85,361 |    ~884ms |    ~164ms |    5.0x |
| Blockers: 8 steps            |    30 |         40,812 |    ~624ms |    ~132ms |    2.4x |
| Blockers: 25 steps           |    98 |        125,081 |    ~843ms |    ~185ms |    7.3x |
| Loop: 20 steps               |    21 |         28,458 |    ~576ms |    ~118ms |    1.7x |
| Loop: 50 steps               |    51 |         44,928 |    ~653ms |    ~131ms |    2.6x |
| Merge: 2 x 50                |   100 |         74,501 |    ~773ms |    ~149ms |    4.3x |
| Merge: 5 x 50                |   250 |        153,884 |  ~1,052ms |    ~208ms |    9.0x |
| Merge: 10 x 50               |   500 |        286,737 |  ~1,461ms |    ~306ms |   16.7x |
| Merge: 20 x 50               | 1,000 |        552,549 |  ~2,278ms |    ~518ms |   32.1x |
| Merge: 50 x 50               | 2,500 |      1,357,277 |  ~5,006ms |  ~1,318ms |   79.0x |
| Middleware: 10 on linear-100 |   100 |         72,311 |    ~808ms |    ~153ms |    4.2x |

See [type-complexity](https://github.com/kvet/queuert/tree/main/benchmarks/type-complexity) for the full benchmark tool and detailed results.

## Query Performance

Per-query latency across state-adapter operations, measured on a seeded dataset (scale = 100). Each query is run 10 times; the table reports the p50 (median). PostgreSQL runs in a Dockerized container (Docker Desktop on macOS, pg driver); SQLite runs in-memory (better-sqlite3). Both adapters run `ANALYZE` after seeding so the query planner has accurate statistics. Node.js v22, Apple M1 Pro.

The benchmark covers every state-adapter method exercised in production: operational queries (the per-job CRUD path) and observability queries (the list/filter/paginate path used by dashboards and cleanup). The dataset is synthetic but covers all statuses, blocker topologies, and continuation chains to exercise the full query surface.

### Operational queries

The `limit10` variants acquire or reclaim ten jobs in one statement, as the worker does when it fills or frees several idle slots at once.

| Query                             | PG p50 (ms) | SQLite p50 (ms) |
| --------------------------------- | ----------: | --------------: |
| getChains/default                 |        1.23 |            0.25 |
| getChains/lock                    |        1.85 |            0.16 |
| getJobs/default                   |        1.05 |            0.09 |
| getJobs/lock                      |        2.62 |            0.13 |
| createJobs/default                |        3.01 |            0.19 |
| createJobs/deduplication          |        2.18 |            0.07 |
| continueJobs/default              |        2.19 |            0.30 |
| addJobsBlockers/default           |        3.94 |            0.23 |
| getJobBlockers/default            |        1.58 |            0.22 |
| unblockJobs/default               |        4.99 |            0.33 |
| startJobAttempts/default          |        3.50 |            0.36 |
| startJobAttempts/limit10          |        4.13 |            0.47 |
| extendJobAttempt/default          |        2.20 |            0.10 |
| completeJobs/default              |        2.57 |            0.40 |
| reclaimExpiredJobAttempts/default |        2.10 |            0.27 |
| reclaimExpiredJobAttempts/limit10 |        2.47 |            0.52 |
| getStartAttemptDelayMs/default    |        2.05 |            0.04 |
| rescheduleJobs/default            |        2.46 |            0.28 |
| deleteChains/default              |        4.43 |            0.43 |
| deleteChains/multiJob             |        3.30 |            0.29 |

### Type discovery & counts

| Query                         | PG p50 (ms) | SQLite p50 (ms) |
| ----------------------------- | ----------: | --------------: |
| listChainTypeNames/default    |        0.87 |            0.06 |
| listJobTypeNames/default      |        0.95 |            0.05 |
| countByChainTypeNames/default |        2.49 |            1.22 |
| countByJobTypeNames/default   |        4.37 |            1.23 |

### List chains

| Query                                         | PG p50 (ms) | SQLite p50 (ms) |
| --------------------------------------------- | ----------: | --------------: |
| **No status filter**                          |             |                 |
| listChains/noStatus/default                   |       20.32 |            0.46 |
| listChains/noStatus/independent               |       57.35 |            0.58 |
| listChains/noStatus/nonIndependent            |       81.45 |           98.31 |
| listChains/noStatus/fromTo                    |       21.73 |            0.58 |
| listChains/noStatus/cursor                    |       46.53 |            0.84 |
| **Running**                                   |             |                 |
| listChains/running/default                    |        4.52 |            0.44 |
| listChains/running/independent                |      107.60 |            0.62 |
| listChains/running/nonIndependent             |       23.61 |           20.02 |
| listChains/running/cursor                     |       11.42 |            1.15 |
| **Completed**                                 |             |                 |
| listChains/completed/default                  |       11.79 |            0.76 |
| listChains/completed/independent              |       35.32 |            0.60 |
| listChains/completed/nonIndependent           |       53.92 |           45.41 |
| listChains/completed/orderByCreatedAt         |       13.45 |            0.53 |
| listChains/completed/orderByCompletedAt       |       10.58 |            0.46 |
| listChains/completed/cursor                   |       24.87 |            0.87 |
| listChains/completed/orderByCreatedAtCursor   |       26.84 |            0.97 |
| listChains/completed/orderByCompletedAtCursor |       24.59 |            0.95 |

### List jobs

The `blocked` status listing has its own partial index (`job_blocked_idx`), which both adapters use to satisfy the filter and the scheduled-at ordering, so it lands in the same range as the `pending` listing.

| Query                                | PG p50 (ms) | SQLite p50 (ms) |
| ------------------------------------ | ----------: | --------------: |
| **No status filter**                 |             |                 |
| listJobs/noStatus/default            |       22.20 |            0.45 |
| listJobs/noStatus/fromTo             |       20.41 |            0.36 |
| listJobs/noStatus/cursor             |       21.49 |            0.66 |
| **Pending**                          |             |                 |
| listJobs/pending/default             |       22.54 |            0.36 |
| listJobs/pending/fromTo              |       22.59 |            0.40 |
| listJobs/pending/orderByCreatedAt    |       27.23 |            0.34 |
| listJobs/pending/cursor              |       23.54 |            0.66 |
| **Blocked**                          |             |                 |
| listJobs/blocked/default             |       16.09 |            0.34 |
| listJobs/blocked/fromTo              |       14.73 |            0.41 |
| listJobs/blocked/orderByCreatedAt    |       17.80 |            0.36 |
| listJobs/blocked/cursor              |       24.00 |            0.64 |
| **Running**                          |             |                 |
| listJobs/running/default             |        5.71 |            7.90 |
| listJobs/running/orderByCreatedAt    |        5.64 |            0.36 |
| listJobs/running/orderByAttemptUntil |        4.99 |            0.38 |
| listJobs/running/cursor              |        8.36 |           12.12 |
| **Completed**                        |             |                 |
| listJobs/completed/default           |       10.84 |            0.37 |
| listJobs/completed/orderByCreatedAt  |       12.82 |            0.35 |
| listJobs/completed/cursor            |       12.71 |            0.67 |

### List chain jobs & blocked jobs

| Query                   | PG p50 (ms) | SQLite p50 (ms) |
| ----------------------- | ----------: | --------------: |
| listChainJobs/default   |        2.16 |            0.43 |
| listChainJobs/cursor    |        5.52 |            0.87 |
| listBlockedJobs/default |      143.13 |          195.61 |
| listBlockedJobs/cursor  |      313.46 |          362.46 |

See [query-performance](https://github.com/kvet/queuert/tree/main/benchmarks/query-performance) for the full benchmark tool, query plans, and per-adapter EXPLAIN output.
