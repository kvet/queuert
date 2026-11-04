# Type Complexity Benchmark

TypeScript type-checking cost across chain topologies and scales. Generates a self-contained `index.ts` + `tsconfig.json` per scenario under `generated/`, then runs TypeScript 6 (the last JS-based `tsc`), TypeScript 7 (the native compiler), and/or [tsrs](https://github.com/oxc-project/tsrs) (an experimental Rust port of the TS 7 checker) with `--extendedDiagnostics` to capture instantiation counts, memory, and time. All three are installed side by side as dev dependencies (`typescript-6`, `typescript-7`, `tsrs`).

## Running

```bash
pnpm start        # every installed compiler
pnpm start ts6    # TypeScript 6 only
pnpm start ts7    # TypeScript 7 only
pnpm start tsrs   # tsrs only
pnpm start ts7 --filter=merge   # only scenarios whose name or family matches
```

Each scenario runs 3 times; the best result is reported. When more than one compiler runs, a comparison table follows, with speedups relative to the first compiler (TS 6 in a full run). Generated scenario files are kept for inspection. Run `pnpm install` first so all compilers are present.

tsrs tracks a newer TS 7.x release than the `typescript-7` dependency, so its instantiation counts can differ slightly from TS 7's. A large gap points at a port divergence rather than a change in Queuert's types.

## Scenarios

| Family       | Shape                                        | Scale             |
| ------------ | -------------------------------------------- | ----------------- |
| `linear`     | Straight-line `continueWith` chains          | 1 → 100 types     |
| `branched`   | Tree-shaped chains varying in width/depth    | ~7 → 127 types    |
| `blockers`   | Cross-chain blocker dependencies (≤ 3)       | ~10 → 98 types    |
| `loop`       | Every step can loop back via unions          | ~6 → 101 types    |
| `merge`      | Multiple slices merged into one client       | 100 → 2,500 types |
| `middleware` | `linear-100` with 1 → 10 attempt middlewares | 100 types         |

## Metrics

- `Instantiations` — primary cost metric
- `Time` — wall-clock compiler time (including I/O)
- `Memory` — peak reported memory
- `Scaling` — relative to the `linear-1` baseline
