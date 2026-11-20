# Custom Notify Adapter (in memory)

A custom `NotifyAdapter` that delivers notifications to listeners in the same process, kept small enough to read in one sitting: a map of listener sets per channel, a `close` that rejects later calls, and listeners isolated from each other's errors. `src/notify-adapter.spec.ts` validates it by registering one test per case from `createNotifyAdapterConformanceCases` and `createNotifyAdapterEndToEndConformanceCases` from `queuert/conformance` with `mode: "async"`. The demo in `src/index.ts` keeps its state in the custom in-memory state adapter from `example-custom-state-memory`.

## Running

```bash
pnpm install
pnpm --filter example-custom-notify-memory start
pnpm --filter example-custom-notify-memory test
```
