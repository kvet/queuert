---
"@queuert/postgres": minor
---

`createPgStateProviderConformanceCases` takes a `singleConnection` option for a provider that runs every transaction on one connection, such as PGlite: it leaves out the cases that need a second transaction to run while the first is still open, so the test file no longer keeps its own list of case titles to skip.
