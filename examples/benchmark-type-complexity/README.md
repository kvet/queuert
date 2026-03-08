# Type Complexity Benchmark

Measures TypeScript type-checking cost of Queuert's type-level machinery across different job chain topologies and scales. Each scenario generates a self-contained `index.ts` + `tsconfig.json` in `generated/<scenario>/`, then runs `tsc` and/or `tsgo` with `--extendedDiagnostics` to capture instantiation counts, memory usage, and wall-clock time.

## Usage

```bash
cd examples/benchmark-type-complexity
pnpm start            # run with all available compilers
pnpm start tsc        # tsc only
pnpm start tsgo       # tsgo only
```

Each scenario is run 3 times and the best result is reported. Generated scenario files are kept in `generated/` for inspection.

## Scenarios

### Single-slice: Linear

Straight-line `continueWith` chains scaling from 1 to 100 types.

| Scenario   | Types |
| ---------- | ----: |
| linear-1   |     1 |
| linear-5   |     5 |
| linear-10  |    10 |
| linear-20  |    20 |
| linear-50  |    50 |
| linear-100 |   100 |

### Single-slice: Branched

Tree-shaped chains with varying width and depth.

| Scenario     | Approx. Types |
| ------------ | ------------: |
| branched-2x2 |             7 |
| branched-3x3 |            40 |
| branched-4x3 |            85 |
| branched-2x6 |           127 |

### Single-slice: Blockers

Chains with cross-chain blocker dependencies (up to 3 blockers per step).

| Scenario    | Approx. Types |
| ----------- | ------------: |
| blockers-3  |            10 |
| blockers-8  |            30 |
| blockers-15 |            58 |
| blockers-25 |            98 |

### Single-slice: Loops

Chains where every step can loop back to itself via `continueWith` unions.

| Scenario | Approx. Types |
| -------- | ------------: |
| loop-5   |             6 |
| loop-10  |            11 |
| loop-20  |            21 |
| loop-50  |            51 |
| loop-100 |           101 |

### Multi-slice: Merge

Multiple independently-typed slices merged via `mergeJobTypeRegistries` / `mergeJobTypeProcessors`, each slice containing a linear chain.

| Scenario    | Slices | Types/Slice | Total Types |
| ----------- | -----: | ----------: | ----------: |
| merge-2x100 |      2 |         100 |         200 |
| merge-5x100 |      5 |         100 |         500 |

## Key metrics

- **Instantiations** — number of type instantiations (primary cost metric)
- **Time** — wall-clock `tsc`/`tsgo` time including I/O overhead
- **Memory** — peak memory usage reported by the compiler
- **Scaling** — instantiations relative to the linear-1 baseline

## Notes

- Requires `typescript` (tsc) and/or `@typescript/native-preview` (tsgo) in the monorepo root
- Builds queuert before running and checks against compiled `.d.mts` (what library consumers experience)
- Generated scenario files are written to `generated/<scenario>/` and kept after the run
