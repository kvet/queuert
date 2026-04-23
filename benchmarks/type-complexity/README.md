# Type Complexity Benchmark

TypeScript type-checking cost across job chain topologies and scales. Generates a self-contained `index.ts` + `tsconfig.json` per scenario under `generated/`, then runs `tsc` and/or `tsgo` with `--extendedDiagnostics` to capture instantiation counts, memory, and time.

## Running

```bash
bun run start       # all available compilers
bun run start tsc   # tsc only
bun run start tsgo  # tsgo only
```

Each scenario runs 3 times; the best result is reported. Generated scenario files are kept for inspection. Requires `typescript` and/or `@typescript/native-preview` in the monorepo root.

## Scenarios

| Family     | Shape                                     | Scale             |
| ---------- | ----------------------------------------- | ----------------- |
| `linear`   | Straight-line `continueWith` chains       | 1 → 100 types     |
| `branched` | Tree-shaped chains varying in width/depth | ~7 → 127 types    |
| `blockers` | Cross-chain blocker dependencies (≤ 3)    | ~10 → 98 types    |
| `loop`     | Every step can loop back via unions       | ~6 → 101 types    |
| `merge`    | Multiple slices merged into one client    | 100 → 2,500 types |

## Metrics

- `Instantiations` — primary cost metric
- `Time` — wall-clock compiler time (including I/O)
- `Memory` — peak reported memory
- `Scaling` — relative to the `linear-1` baseline
