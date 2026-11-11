# Custom Notify Adapter (in memory)

A custom `NotifyAdapter` that delivers notifications to listeners in the same process, kept small enough to read in one sitting: a map of listener sets per channel, a `close` that rejects later calls, and listeners isolated from each other's errors. `src/notify-adapter.spec.ts` validates it by registering one test per case in `notifyAdapterConformanceCases` and `notifyAdapterEndToEndConformanceCases` from `queuert/conformance`. The demo in `src/index.ts` keeps its state in an in-memory SQLite database.

## Running

```bash
pnpm install
pnpm --filter example-notify-custom-memory start
pnpm --filter example-notify-custom-memory test
```
