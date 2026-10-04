---
"queuert": major
---

Remove internal helper types from the `queuert` package exports. These types described implementation details rather than the API you call, and keeping them exported locked their shapes in place. Nothing changes at runtime; if you imported one of them, derive it from the public API (e.g. `Parameters<typeof createJobTypes>[0]`) or inline the shape.

- `JobTypesOptions` is removed; `createJobTypes` takes the same options object inline.
- `JobTypeDefs`, `NominalJobTypeReference`, `StructuralJobTypeReference` and `ResolvedJobTypeReference` are no longer exported.
- `ResolvedChain`, `ResolvedChainJobs`, `ResolvedJob`, `BlockerChains` and `JobTypeProperty` are no longer exported.
- `AttemptHandler`, `AttemptPrepare`, `AttemptPrepareCallback`, `AttemptPrepareOptions`, `AttemptComplete`, `AttemptCompleteCallback` and `AttemptCompleteOptions` are no longer exported.
- `ProcessorDefinitions` and `InProcessWorkerProcessor` are no longer exported.
