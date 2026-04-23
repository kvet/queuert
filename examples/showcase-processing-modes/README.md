# Processing Modes Showcase

Processing modes through an order fulfillment workflow.

Scenarios: auto-setup atomic (just `complete()`), staged mode (`prepare()` around external calls), auto-setup staged (async work before `complete()` without explicit `prepare()`).

## Running

```bash
bun install
bun run --filter example-showcase-processing-modes start
```
