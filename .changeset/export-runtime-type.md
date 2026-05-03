---
"@queuert/postgres": minor
"@queuert/sqlite": minor
---

Re-export the `RuntimeType` union from `@queuert/postgres` and `@queuert/sqlite`.

`RuntimeType` is the runtime tag that appears in `executeSql`'s `paramTypes` / `columnTypes` records (`"string"`, `"uuid"`, `"json"`, `"date?"`, etc.). Custom state-provider authors previously had to either restate the union inline or pull it from the internal `@queuert/typed-sql` package. Both adapter packages now re-export it so providers can type-narrow their serialization/parsing logic without reaching into internals.
