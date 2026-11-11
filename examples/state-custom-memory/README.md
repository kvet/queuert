# Custom State Adapter (in memory)

A custom `StateAdapter` that keeps chains, jobs, blockers and workers in plain `Map`s and an array, written for reading rather than speed: every query is a linear scan. A transaction works on a copy of the state and swaps it in on commit, and a promise chain runs transactions one at a time; a call without a transaction context runs as its own transaction. `src/state-adapter.spec.ts` validates it by registering one test per case in `stateAdapterConformanceCases` and `stateAdapterEndToEndConformanceCases` from `queuert/conformance`, giving each case a fresh adapter. It skips `concurrentStateAdapterConformanceCases` and `concurrentStateAdapterEndToEndConformanceCases`, whose cases hold two transactions open at once, which an adapter that runs transactions one at a time cannot do.

## Running

```bash
pnpm install
pnpm --filter example-state-custom-memory start
pnpm --filter example-state-custom-memory test
```
