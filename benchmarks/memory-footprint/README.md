# Memory Footprint Benchmark

Measures Queuert's steady-state heap footprint per adapter. The headline question: **once you close queuert, does it release its allocated heap?** Yes for live JS state — what remains is V8 metadata (hidden classes, JIT-compiled code) that's tied to module load, not to queuert holding references.

Headline numbers live in the [Benchmarks docs page](../../docs/src/content/docs/benchmarks.md) — this README covers methodology and how to reproduce them.

## Methodology

Each benchmark runs in its own child process (`node --expose-gc`) and follows this pattern:

1. **Bring up infrastructure** (containers, driver clients, OTel providers, …) — anything that lives outside queuert's lifecycle.
2. **Warmup run.** Build queuert adapters, process 100 jobs, close everything. Discarded — its job is to JIT-compile queuert code paths, the measurement helpers (`measureMemory`, `diffMemory`, `formatBytes`), the console.log call chain, and trigger lazy module loads in transitive dependencies (e.g. `protobufjs` schemas pulled in by `testcontainers`). The warmup uses the same context shape as the measured run, with stdout suppressed at the `process.stdout.write` level so the full code path fires.
3. **Capture the infrastructure baseline.** Multi-cycle GC, then `process.memoryUsage()` _and_ a heap snapshot. Both are baselines for the measured run.
4. **Measured run.** Same lifecycle. Each step's heap delta logs from the infra baseline; the post-processing peak is captured.
5. **Snapshot after close.** Multi-cycle GC, second snapshot. Two deltas are computed from the snapshots: the **live JS object** delta (the "does queuert leak?" answer, typically ~10 KB across all adapters) and the **V8 JIT code** delta (module-permanent compilation cost, varies by adapter complexity).

The lifecycle is wrapped in a function so its locals (adapter references captured by `measureMemory` tuples) truly go out of scope when it returns — without that, destructured refs would pin adapters past `close()`.

## Why heap snapshot beats `process.memoryUsage().heapUsed`

`heapUsed` over-reports retention significantly: it includes V8 heap fragmentation, the code arena, and internal accounting that isn't part of the live JS object graph. On the same workload, `heapUsed` shows +330–600 KB of "retention" while the snapshot shows ~10 KB of live JS objects plus 40–190 KB of JIT-compiled code. The snapshot is the truth — `heapUsed` includes a lot of V8 free-list pages and metadata that aren't actually retained anything.

The framework reports `heapUsed` for transparency but the snapshot-based numbers (live JS + JIT code) are the meaningful ones.

## Running

```bash
bun run start                 # all measurements (requires Docker)
bun run start:state-postgres  # PostgreSQL state adapter
bun run start:state-sqlite    # SQLite state adapter
bun run start:notify-redis    # Redis notify adapter
bun run start:notify-postgres # PostgreSQL notify adapter
bun run start:notify-nats     # NATS notify adapter
bun run start:otel            # OpenTelemetry observability adapter
bun run start:dashboard       # Dashboard
```

Container-based measurements require Docker.

Heap snapshots are streamed in-memory by default — no disk I/O. Set `HEAP_DUMPS=1` to also persist them to `heap-dumps/` for inspection in Chrome DevTools' Memory → Comparison view (or via `scripts/diff-snapshots.ts`).

## Adding a new benchmark

Use the `runDoubleRunBenchmark` scaffold in `src/utils.ts`. Provide:

- `name` — slug used in heap snapshot filenames
- `setupInfrastructure()` — returns shared infra (containers, driver clients) plus a teardown function. Logs its own per-step deltas using `measureMemory`/`diffMemory`.
- `runLifecycle(infra, ctx)` — builds queuert adapters, does work, closes everything. Called twice (warmup + measured). Use `ctx.step` for setup steps and `ctx.processStep` for the work step (the latter records the in-flight peak).

## Reading the per-step output

```
After processing 100 jobs (delta from infra baseline):
  Heap used:   +240 KB        ← in-flight peak (heapUsed; over-reports)

── Queuert closed (lifecycle returned, GC'd) ──

Delta from infra baseline:
  Heap used:   ~0 KB          ← over-reports the other way (GC noise + V8 internals)

  SUMMARY
  Queuert setup overhead:        +75 KB    ← state + notify + client + worker, fully built
  Queuert in-flight (peak):     +240 KB    ← heap during 100 in-flight jobs
  After close (heapUsed):       ~0 KB      ← V8 internal accounting; not the real answer
  After close (live JS objects): +10 KB    ← live JS heap delta — the "does it leak?" answer
  After close (V8 JIT code):    +50 KB     ← module-permanent JIT code, not a leak per lifecycle
```

`RSS` is printed in step deltas but isn't a useful metric: V8 doesn't return freed pages to the OS, and `v8.writeHeapSnapshot()` itself temporarily inflates RSS by tens of MB while it walks the heap.
