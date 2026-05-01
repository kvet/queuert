---
"queuert": patch
"@queuert/postgres": patch
---

Normalize `RescheduleJobError` cause handling and stop re-exporting `BaseTxContext` from `queuert/internal`.

### `RescheduleJobError` cause handling

Constructed without an explicit `cause`, `RescheduleJobError` no longer carries a `cause: undefined` property — matching every other error in `queuert`. `'cause' in err` is `false` when the caller didn't supply one. Code that calls `rescheduleJob(schedule)` or `new RescheduleJobError("...", { schedule })` is unaffected at the value level (`err.cause` is still `undefined`); only structural checks like `'cause' in err` change.

### `BaseTxContext` import path

`BaseTxContext` is now exported only from `queuert`. The duplicate re-export from `queuert/internal` is removed. The type was already exported from both entry points; this drops the inconsistency. If you imported `BaseTxContext` from `queuert/internal`, change the import to:

```ts
import { type BaseTxContext } from "queuert";
```

The bundled `@queuert/postgres` provider type now imports `BaseTxContext` from `queuert` (matching `@queuert/sqlite`); no behavior change.
