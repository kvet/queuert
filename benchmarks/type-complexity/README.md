# Type Complexity Benchmark

TypeScript type-checking cost across chain topologies and scales. Generates a self-contained `index.ts` + `tsconfig.json` per scenario under `generated/`, then runs TypeScript 6 (the last JS-based `tsc`) and/or TypeScript 7 (the native compiler) with `--extendedDiagnostics` to capture instantiation counts, memory, and time. Both are installed side by side as aliased dev dependencies (`typescript-6`, `typescript-7`).

## Running

```bash
bun run start       # both compilers
bun run start ts6   # TypeScript 6 only
bun run start ts7   # TypeScript 7 only
```

Each scenario runs 3 times; the best result is reported. Generated scenario files are kept for inspection. Run `bun install` first so both `typescript-6` and `typescript-7` are present.

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
