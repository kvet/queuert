---
"@queuert/otel": minor
---

Metrics from `@queuert/otel` no longer carry the `queuert.worker.id` attribute. Worker IDs are random for each process start, so every restart or deploy created a new set of time series and metric cardinality grew without limit. The worker ID stays on job attempt spans. If you need per-process metrics, use an OTEL resource attribute such as `service.instance.id`.

- Removed `queuert.worker.id` from `queuert.worker.*` counters, `queuert.job.attempt.*` counters, the `queuert.job.attempt.duration` histogram, and the `queuert.job_type.idle` / `queuert.job_type.processing` gauges.
- Dashboards or alerts that group or filter these metrics by `queuert.worker.id` need updating.
