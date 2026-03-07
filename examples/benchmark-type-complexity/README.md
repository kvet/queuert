# Type Complexity Benchmark

Measures TypeScript type-checking cost of Queuert's type-level machinery across different job chain patterns and scales. Each scenario generates a self-contained `.ts` file with `defineJobTypes`, `createClient`, and `createInProcessWorker` calls, then runs `tsc` and/or `tsgo` with `--extendedDiagnostics` to capture instantiation counts, memory usage, and wall-clock time.

## Usage

```bash
cd examples/benchmark-type-complexity
pnpm start            # run with default compiler (tsgo)
pnpm start tsc        # tsc only
pnpm start tsgo       # tsgo only
```

Each scenario is run 3 times and the best result is reported.

## What it measures

### Single-registry scenarios

Exercises the core type machinery (`defineJobTypes`, `ChainJobTypeNames`, `ChainReachMap`, `ResolvedJob`) with a single job type registry:

- **Linear chains** — 3 to 30 types in a straight line (`continueWith`)
- **Branched chains** — tree-shaped chains (2-4 breadth, 2-3 depth)
- **Blockers** — chains with cross-chain blocker dependencies (3-8 steps)
- **Loops** — chains with `continueWith` cycles (3-20 steps)

### Multi-slice (merge) scenarios

Exercises `mergeJobTypeRegistries` and `mergeJobTypeProcessors` with multiple independently-typed slices merged into a single client/worker:

- **Merge** — 2-4 slices of 3-10 types each
- **Many** — 10-20 slices of 3-step chains

## Key metrics

- **Instantiations** — number of type instantiations (primary cost metric)
- **Time** — wall-clock `tsc`/`tsgo` time including I/O overhead
- **Memory** — peak memory usage reported by the compiler
- **Scaling** — instantiations relative to the linear-3 baseline

## Results

> Snapshot taken 2026-03-07. Re-run `pnpm start` for current numbers.

### tsc 5.9.3

| Scenario             | Job Types |  Time | Instantiations | Memory | Scaling |
| -------------------- | --------: | ----: | -------------: | -----: | ------: |
| Linear: 3 types      |         6 | 461ms |         21,344 |  108MB |    1.0x |
| Linear: 5 types      |        10 | 466ms |         23,684 |  120MB |    1.1x |
| Linear: 10 types     |        20 | 498ms |         29,954 |  123MB |    1.4x |
| Linear: 20 types     |        40 | 534ms |         44,294 |  123MB |    2.1x |
| Linear: 30 types     |        60 | 568ms |         61,034 |  127MB |    2.9x |
| Branched: 2w x 2d    |        14 | 490ms |         25,085 |  120MB |    1.2x |
| Branched: 3w x 3d    |        80 | 609ms |         71,087 |  119MB |    3.3x |
| Branched: 4w x 3d    |       170 | 809ms |        173,891 |  161MB |    8.1x |
| Blockers: 3 steps    |        20 | 558ms |         31,009 |  123MB |    1.5x |
| Blockers: 5 steps    |        36 | 530ms |         44,665 |  116MB |    2.1x |
| Blockers: 8 steps    |        60 | 560ms |         71,089 |  132MB |    3.3x |
| Loop: 3 steps        |         8 | 463ms |         22,696 |  119MB |    1.1x |
| Loop: 5 steps        |        12 | 481ms |         25,084 |  117MB |    1.2x |
| Loop: 10 steps       |        22 | 505ms |         31,474 |  118MB |    1.5x |
| Loop: 20 steps       |        42 | 535ms |         46,054 |  121MB |    2.2x |
| Merge: 2 slices x 3  |        12 | 482ms |         28,854 |  114MB |    1.4x |
| Merge: 3 slices x 5  |        30 | 525ms |         39,041 |  115MB |    1.8x |
| Merge: 4 slices x 10 |        80 | 623ms |         73,906 |  125MB |    3.5x |
| Many: 10 x 3-step    |        60 | 569ms |         59,638 |  120MB |    2.8x |
| Many: 20 x 3-step    |       120 | 687ms |        114,858 |  136MB |    5.4x |

### tsgo 7.0.0-dev

| Scenario             | Job Types |  Time | Instantiations | Memory | Scaling |
| -------------------- | --------: | ----: | -------------: | -----: | ------: |
| Linear: 3 types      |         6 | 104ms |         21,491 |   59MB |    1.0x |
| Linear: 5 types      |        10 | 104ms |         23,861 |   59MB |    1.1x |
| Linear: 10 types     |        20 | 114ms |         30,206 |   60MB |    1.4x |
| Linear: 20 types     |        40 | 116ms |         44,696 |   61MB |    2.1x |
| Linear: 30 types     |        60 | 126ms |         61,586 |   63MB |    2.9x |
| Branched: 2w x 2d    |        14 | 106ms |         25,250 |   59MB |    1.2x |
| Branched: 3w x 3d    |        80 | 132ms |         71,425 |   64MB |    3.3x |
| Branched: 4w x 3d    |       170 | 191ms |        174,386 |   71MB |    8.1x |
| Blockers: 3 steps    |        20 | 108ms |         31,180 |   60MB |    1.5x |
| Blockers: 5 steps    |        36 | 114ms |         44,876 |   61MB |    2.1x |
| Blockers: 8 steps    |        60 | 126ms |         71,360 |   64MB |    3.3x |
| Loop: 3 steps        |         8 | 104ms |         22,880 |   59MB |    1.1x |
| Loop: 5 steps        |        12 | 104ms |         25,298 |   59MB |    1.2x |
| Loop: 10 steps       |        22 | 111ms |         31,763 |   60MB |    1.5x |
| Loop: 20 steps       |        42 | 120ms |         46,493 |   62MB |    2.2x |
| Merge: 2 slices x 3  |        12 | 110ms |         30,406 |   61MB |    1.4x |
| Merge: 3 slices x 5  |        30 | 113ms |         40,769 |   63MB |    1.9x |
| Merge: 4 slices x 10 |        80 | 134ms |         76,146 |   67MB |    3.5x |
| Many: 10 x 3-step    |        60 | 143ms |         61,590 |   66MB |    2.9x |
| Many: 20 x 3-step    |       120 | 166ms |        117,310 |   72MB |    5.5x |

## Findings

### No more TS2589 at 30 types

After restructuring `ChainJobTypeNames` as a tail-recursive conditional type with an accumulator, tsc no longer hits the "excessively deep" error at 30 linear types. The tail-call pattern raises TypeScript's recursion limit from ~50 to 1000, removing the practical ceiling entirely.

### Precomputed `ChainReachMap` eliminates redundant per-type evaluation

By precomputing chain reachability in a single mapped type (`ChainReachMap<Defs>`) parameterized only by `Defs`, all `ChainTypesReaching<Defs, K>` lookups share one cached evaluation. This reduced blockers-8 from 498k to 71k instantiations (86% reduction) and branched-4x3 from 431k to 173k (60% reduction).

### ~71% fewer instantiations at baseline vs original

Baseline instantiations dropped from ~74k to ~21k (tsc) through the combination of tail-recursive `ChainJobTypeNames`, `infer`-based deduplication, and precomputed chain reachability.

### Unrolled merge recursion raises slice limit from ~50 to ~400

`MergeDefinitions`, `ValidatedRegistries`, `ValidatedSlices`, and `MergedKeys` now process 8 tuple elements per recursion step instead of 1. This raises the practical recursion limit from ~50 to ~400 slices, eliminating TS2589 for `mergeJobTypeRegistries`/`mergeJobTypeProcessors` at scale.

### tsgo is 4-5x faster than tsc in wall-clock time

tsgo consistently outperforms tsc across all scenarios. Despite similar instantiation counts, tsgo's Go-based architecture delivers substantially faster checking.

### Memory usage: tsgo uses ~45-55% less

tsgo's memory footprint is substantially lower: 59-92MB vs tsc's 109-165MB for passing scenarios.

### Scaling by pattern

- **Linear/Loop**: Near-linear growth (~2.2-2.9x at 20-30 types)
- **Branched**: Moderate growth (8.1x for 4w x 3d — the most complex scenario)
- **Blockers**: Moderate growth (3.3x for 8 steps)
- **Merge**: Moderate growth (3.5x for 4x10)
- **Many (merged slices)**: Super-linear growth (5.5x for 20 slices of 3-step chains)

### Many-slice merges scale super-linearly

Instantiation counts grow super-linearly with the number of slices: 20 slices of 3-step chains costs ~115k instantiations (~5.5x baseline). The bottleneck at higher slice counts is `Client<MergedDefs>` type expansion — its methods distribute `ResolvedJobChain`/`ResolvedJob` over all entry/job type unions. See TODO.md for the planned fix.

## Practical Limits

| Configuration                                | tsc        | tsgo       |
| -------------------------------------------- | ---------- | ---------- |
| Up to 30 types in a single chain             | OK, <600ms | OK, <130ms |
| Branched chains up to 3w x 3d (~80 types)    | OK, <670ms | OK, <140ms |
| 4w x 3d branching (~170 types)               | OK, <850ms | OK, ~190ms |
| Blockers: up to 8 steps with 3 blockers each | OK, <580ms | OK, <130ms |
| Merging up to 4 slices of 10 types           | OK, <630ms | OK, <140ms |
| Many: 10 slices x 3-step chains (60 types)   | OK, <570ms | OK, <145ms |
| Many: 20 slices x 3-step chains (120 types)  | OK, <690ms | OK, <170ms |

## Notes

- Requires `typescript` (tsc) and/or `@typescript/native-preview` (tsgo) in the monorepo root
- Builds queuert before running and checks against compiled `.d.mts` (what library consumers experience)
- Generated scenario files are written to `src/_scenario.gen.ts` and cleaned up after the run
