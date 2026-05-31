---
"@queuert/postgres": patch
---

Pin Postgres autovacuum on the `job` and `job_blocker` tables to a fixed dead-tuple threshold instead of a table-size-proportional scale factor. A new migration sets `autovacuum_vacuum_threshold = 5000` / `autovacuum_vacuum_scale_factor = 0` (and the matching analyze knobs), replacing the previous `scale_factor = 0.02`. On modern Postgres (≥14) vacuum cost tracks the actively-churned set rather than the whole table, so a fixed threshold gives a predictable vacuum cadence regardless of table size and avoids delaying vacuum on large tables that have accumulated completed history. The threshold can be retuned per deployment with `ALTER TABLE … SET (autovacuum_vacuum_threshold = …)` if needed.
