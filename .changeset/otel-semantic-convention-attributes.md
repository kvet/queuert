---
"@queuert/otel": major
---

Rename every OTel metric attribute key to match OpenTelemetry semantic-convention style (lowercase, dotted) and to align with the span attributes already emitted by the tracing layer. The metric _names_ are unchanged, so existing queries still resolve — but any dashboard, alert, or recording rule that groups by or filters on the old attribute keys will silently return empty results until updated. Audit your observability stack before upgrading.

- `workerId` → `queuert.worker.id`
- `typeName` → `queuert.job.type`
- `chainTypeName` → `queuert.chain.type`
- `continued` → `queuert.job.continued`
- `operation` → `queuert.adapter.operation`

Affects every counter, histogram, and gauge emitted by `createOtelObservabilityAdapter` (worker lifecycle, job lifecycle, attempt lifecycle, chain lifecycle, adapter errors, durations, and job-type gauges). See the [OTel Metrics reference](https://kvet.github.io/queuert/advanced/otel-metrics/) for the full per-metric attribute list.

Two attribute value encodings also changed on `queuert.job.completed`:

- `queuert.job.continued` is now a real boolean (`true` / `false`) instead of the string `"true"` / `"false"`.
- `queuert.worker.id` is now omitted for workerless completions instead of being set to the string `"null"`. Queries that filter on the literal string `"null"` (or rely on the attribute always being present) need updating.
