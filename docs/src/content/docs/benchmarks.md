---
title: Benchmarks
description: Processing capacity, memory footprint, and type complexity benchmarks for Queuert.
---

## Processing Capacity

Job throughput measured in two phases: starting chains (chains/s) and processing them to completion (jobs/s). Each adapter is exercised across four orthogonal modes — single vs. batched start (`startChain` one at a time vs. `startChains` in batches of 100), and atomic vs. staged processing (see [Job Processing Modes](./guides/processing-modes/)). To avoid doubling the wall-clock, the four numbers are folded into two runs per adapter: atomic-process pairs with batched-start, staged-process pairs with single-start. The pairing is layout-only — start mode and process mode are independent in production. Each run uses 5,000 chains × concurrency 10, in its own child process for isolation (Node.js v22, Apple M1 Pro). State and notify are measured along separate axes — when one is varied, the other is held at the in-process default. PostgreSQL, Redis, and NATS run as Dockerized containers on macOS (Docker Desktop), so per-RTT latency includes the VM bridge — numbers reflect that environment rather than a host-native or production deployment.

The Start columns measure two ends of the realistic range: **single** is a tight `await client.startChain(...)` loop, dominated by per-call RTT (HTTP-handler-shaped traffic); **batched** is `client.startChains({ items: [...100] })`, amortizing transaction and notify overhead across the batch (bulk-enqueue / migration / replay traffic). Real workloads sit between the two depending on call shape and concurrency.

The Process columns measure how fast a single worker drains the queue once it's full. Atomic mode wraps each attempt in one transaction; staged mode adds an empty `prepare({ mode: "staged" })` round-trip before `complete`, isolating the pure cost of the second transaction without confounding with handler work. Steady-state deployment throughput is bounded by `min(start, process)`.

### State adapter (no notify)

| State adapter            | Start single (chains/s) | Start batched (chains/s) | Process atomic (jobs/s) | Process staged (jobs/s) |
| ------------------------ | ----------------------: | -----------------------: | ----------------------: | ----------------------: |
| In-process               |                 ~67,459 |                 ~173,791 |                 ~17,753 |                 ~12,191 |
| SQLite (better-sqlite3)  |                 ~21,757 |                  ~51,653 |                 ~10,214 |                  ~6,837 |
| SQLite (node:sqlite)     |                 ~20,208 |                  ~51,833 |                  ~8,286 |                  ~5,747 |
| PostgreSQL (postgres-js) |                    ~504 |                  ~20,317 |                    ~725 |                    ~634 |
| PostgreSQL (pg)          |                    ~584 |                  ~20,880 |                    ~766 |                    ~647 |

### Notify adapter (in-process state)

| Notify adapter           | Start single (chains/s) | Start batched (chains/s) | Process atomic (jobs/s) | Process staged (jobs/s) |
| ------------------------ | ----------------------: | -----------------------: | ----------------------: | ----------------------: |
| In-process               |                 ~64,051 |                 ~191,963 |                 ~17,829 |                 ~12,322 |
| Redis (redis)            |                  ~2,478 |                  ~68,248 |                  ~8,932 |                  ~6,364 |
| Redis (ioredis)          |                  ~2,485 |                  ~72,958 |                 ~10,868 |                  ~7,892 |
| PostgreSQL (pg)          |                  ~3,871 |                  ~72,343 |                  ~7,863 |                  ~5,590 |
| PostgreSQL (postgres-js) |                  ~3,864 |                  ~70,733 |                  ~7,675 |                  ~4,787 |
| NATS                     |                  ~4,275 |                 ~107,948 |                 ~10,286 |                  ~7,129 |

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

Queuert's type-level machinery scales linearly across chain topologies (prebuilt `.d.mts`, Node.js v22, Apple M1 Pro):

### tsc (6.0.2)

| Scenario           | Types |     Time | Instantiations | Scaling |
| ------------------ | ----: | -------: | -------------: | ------: |
| Linear: 1 type     |     1 |   ~554ms |         20,644 |    1.0x |
| Linear: 10 types   |    10 |   ~583ms |         30,481 |    1.5x |
| Linear: 50 types   |    50 |   ~762ms |         72,081 |    3.5x |
| Linear: 100 types  |   100 |   ~993ms |        124,081 |    6.0x |
| Branched: 4w x 3d  |    85 |   ~981ms |        104,856 |    5.1x |
| Branched: 2w x 6d  |   127 | ~1,175ms |        148,556 |    7.2x |
| Blockers: 8 steps  |    30 |   ~661ms |         54,136 |    2.6x |
| Blockers: 25 steps |    98 |   ~987ms |        160,488 |    7.8x |
| Loop: 20 steps     |    21 |   ~653ms |         44,654 |    2.2x |
| Loop: 50 steps     |    51 |   ~834ms |         79,964 |    3.9x |
| Merge: 2 x 50      |   100 |   ~974ms |        128,242 |    6.2x |
| Merge: 5 x 50      |   250 | ~1,511ms |        281,574 |   13.6x |
| Merge: 10 x 50     |   500 | ~2,390ms |        537,404 |   26.0x |
| Merge: 20 x 50     | 1,000 | ~4,070ms |      1,049,169 |   50.8x |
| Merge: 50 x 50     | 2,500 | ~9,630ms |      2,589,554 |  125.4x |

### Practical limits

| Configuration                              | Status          |
| ------------------------------------------ | --------------- |
| Up to 100 types in a single linear chain   | OK, ~1.0s (tsc) |
| Branched chains up to 2w x 6d (~127 types) | OK, ~1.2s (tsc) |
| Blockers: up to 25 steps, 3 blockers each  | OK, <1s (tsc)   |
| Loops: up to 50 self-referencing steps     | OK, <1s (tsc)   |
| Merging 10 slices of 50 types (500 total)  | OK, ~2.4s (tsc) |
| Merging 50 slices of 50 types (2500 total) | OK, ~9.6s (tsc) |

See [type-complexity](https://github.com/kvet/queuert/tree/main/benchmarks/type-complexity) for the full benchmark tool and detailed results.
