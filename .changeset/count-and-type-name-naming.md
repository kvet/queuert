---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

The type-name and per-key count methods on the client and the `StateAdapter` interface are renamed so `list*` always means a paginated method and each count names what it counts. Signatures and results are unchanged; rename the calls, and custom state adapters rename the methods they implement.

- `listChainTypeNames` → `getChainTypeNames`, `listJobTypeNames` → `getJobTypeNames`.
- `countByChainTypeNames` → `countChainsByTypeName`, `countByJobTypeNames` → `countJobsByTypeName`.
- The `operation` reported on `state_adapter_error` logs and the `queuert.state_adapter.error` metric uses the new method names.
