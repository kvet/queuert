---
"queuert": major
---

`queuert/conformance` exports Queuert's end-to-end cases as case lists of their own, so a custom adapter that passes them also works under a real client and worker runners: each end-to-end case builds a client and worker runners over the adapter under test and checks what an application observes, from chains, blockers and scheduling to deduplication, deletion, workerless completion, notifications and recovery from errors. They take a few seconds in all, so you may run them apart from the fast contract cases, such as only in CI; you run them the same way, one test per case with your own test runner.

- `stateAdapterEndToEndConformanceCases` and `concurrentStateAdapterEndToEndConformanceCases` run the end-to-end cases against a state adapter, the second holding the cases that need transactions running in parallel, such as several blocker chains completing at once.
- `notifyAdapterEndToEndConformanceCases` run the end-to-end cases against a notify adapter; they keep state in an in-memory state adapter, so no database is needed.
- `StateAdapterConformanceContext` takes an optional `createNotifyAdapter`, shared by every client and worker runner of an end-to-end case; without it each case uses an in-process notify adapter.
- The `Expect` type is no longer exported from `queuert/conformance`.
- The `StateJob`, `StateJobInfo`, `StateChain`, `StateChainInfo`, `StateJobBlockerInfo`, `StateBlockedJob`, `StateDependentJob`, `StateWorkerInfo`, `StateCount`, `StateWorkerCounts`, `StateJobStatus` and `StateChainStatus` types that `StateAdapter` members take and return are exported from `queuert`, and no longer from `queuert/internal`.
