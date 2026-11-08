# Runtime Performance Benchmark

Measures what Queuert costs at runtime per adapter, in two phases:

- **Memory** — Queuert's steady-state heap footprint. The headline question: **once you close queuert, does it release its allocated heap?** Yes for live JS state — what remains is V8 metadata (hidden classes, JIT-compiled code) that's tied to module load, not to queuert holding references.
- **Profile** — where CPU time and allocations go per job, so hot paths are measured before optimizing.

Headline numbers live in the [Runtime Performance docs page](../../docs/src/content/docs/benchmarks/runtime-performance.tsx) (numbers in [`docs/src/data/benchmarks.ts`](../../docs/src/data/benchmarks.ts)) — this README covers methodology and how to reproduce them.

## Memory phase

Each benchmark runs in its own child process (`node --expose-gc --no-flush-bytecode`, so V8 does not drop compiled code mid-measurement) and follows this pattern:

1. **Bring up infrastructure** (containers, driver clients, OTel providers, …) — anything that lives outside queuert's lifecycle.
2. **Warmup run.** Build queuert adapters, process 100 jobs, close everything. Discarded — its job is to JIT-compile queuert code paths, the measurement helpers (`measureMemory`, `diffMemory`, `formatBytes`), the console.log call chain, and trigger lazy module loads in transitive dependencies (e.g. `protobufjs` schemas pulled in by `testcontainers`). The warmup uses the same context shape as the measured run, with stdout suppressed at the `process.stdout.write` level so the full code path fires.
3. **Capture the infrastructure baseline.** Multi-cycle GC, then `process.memoryUsage()` _and_ a heap snapshot. Both are baselines for the measured run.
4. **Measured run.** Same lifecycle. Each step's heap delta logs from the infra baseline; the post-processing peak is captured.
5. **Snapshot after close.** Multi-cycle GC, second snapshot. Two deltas are computed from the snapshots: the **live JS object** delta (the "does queuert leak?" answer, typically ~10 KB across all adapters) and the **V8 JIT code** delta (module-permanent compilation cost, varies by adapter complexity).

The lifecycle is wrapped in a function so its locals (adapter references captured by `measureMemory` tuples) truly go out of scope when it returns — without that, destructured refs would pin adapters past `close()`.

### Why heap snapshot beats `process.memoryUsage().heapUsed`

`heapUsed` over-reports retention significantly: it includes V8 heap fragmentation, the code arena, and internal accounting that isn't part of the live JS object graph. On the same workload, `heapUsed` shows +330–600 KB of "retention" while the snapshot shows ~10 KB of live JS objects plus 40–190 KB of JIT-compiled code. The snapshot is the truth — `heapUsed` includes a lot of V8 free-list pages and metadata that aren't actually retained anything.

The framework reports `heapUsed` for transparency but the snapshot-based numbers (live JS + JIT code) are the meaningful ones.

## Profile phase

Each adapter runs the same `runLifecycle` in a separate child process from the memory phase, so heap snapshots and forced GC never overlap a profile:

1. **Bring up infrastructure**, as in the memory phase.
2. **Warmup run** of 2,000 jobs, discarded.
3. **Profiled run** of 2,000 jobs. The CPU profiler (100 µs sampling) and the sampling heap profiler (4 KB interval, counting objects already collected by GC) run through `node:inspector/promises` only around the work step, so setup, migrations and `close()` stay out of the profile.

The work step creates chains one transaction at a time while a worker completes them, and finishes once the attempt handler has completed every job, so the cost per job covers creation and processing.

Queuert packages load from their built `dist` output, the code published to npm: `src/dist-hooks.ts` resolves `queuert` and `@queuert/*` to their `publishConfig.exports`, while the benchmark itself runs as TypeScript through Node's type stripping. Before writing the profiles, every frame is mapped back to its TypeScript file, line and function name through the source maps of `dist`.

Each sample is put in one category by the file of its frame:

- `core` — `packages/core` and `packages-internal/helpers`
- `adapter` — the other `packages/*` and `packages-internal/typed-sql`
- `dependencies` — anything under `node_modules` (drivers, OpenTelemetry SDK, …)
- `runtime` — Node internals, V8 builtins, `(program)` and `(garbage collector)`
- `harness` — the benchmark itself and the example providers it uses
- `idle` — waiting on I/O; left out of the CPU total

## Output

- `results/memory/<adapter>.txt` — the memory summary.
- `results/profile/<adapter>.txt` — CPU µs and allocated KB per job by category, the process CPU time from `process.cpuUsage()`, and the top functions by self time and by self allocation.
- `profiles/<adapter>.cpuprofile` and `profiles/<adapter>.heapprofile` — the raw profiles with TypeScript locations, for Chrome DevTools (Performance / Memory panels) or [speedscope](https://www.speedscope.app/).

`results/`, `profiles/` and `heap-dumps/` are git-ignored.

## Running

```bash
pnpm start                 # all measurements (requires Docker)
pnpm start:state-postgres  # PostgreSQL state adapter
pnpm start:state-sqlite    # SQLite state adapter
pnpm start:notify-redis    # Redis notify adapter
pnpm start:notify-postgres # PostgreSQL notify adapter
pnpm start:notify-nats     # NATS notify adapter
pnpm start:otel            # OpenTelemetry observability adapter
pnpm start:dashboard       # Dashboard

pnpm start:state-sqlite --profile  # one phase only (--memory or --profile)
```

Both phases run by default. Each run first builds the queuert packages; pass `--skip-build` to reuse the existing `dist` output. The measurements require Node.js 24 (see `.nvmrc`), and container-based ones require Docker.

Heap snapshots are streamed in-memory by default — no disk I/O. Set `HEAP_DUMPS=1` to also persist them to `heap-dumps/` for inspection in Chrome DevTools' Memory → Comparison view.

## Adding a new benchmark

Use the `runDoubleRunBenchmark` scaffold in `src/utils.ts`. Provide:

- `name` — slug used in heap snapshot filenames
- `setupInfrastructure()` — returns shared infra (containers, driver clients) plus a teardown function. Logs its own per-step deltas using `measureMemory`/`diffMemory`.
- `runLifecycle(infra, ctx)` — builds queuert adapters, does work, closes everything. Called twice per phase (warmup + measured). Use `ctx.step` for setup steps and `ctx.processStep` for the work step (it records the in-flight peak in the memory phase and is the profiled window in the profile phase). The work step processes `ctx.jobCount` jobs: 100 in the memory phase, 2,000 in the profile phase.

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
