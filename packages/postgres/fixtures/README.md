# Migration fixtures

A queuert **v0.15.1** database, used by `src/specs/legacy-upgrade.spec.ts` to exercise the
upgrade path onto the current schema.

| File                    | Contents                                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v0.15.1.schema.sql`    | The v0.15.1 schema: the six migrations that shipped in v0.15.1 with `{{schema}}`/`{{table_prefix}}`/`{{id_type}}` resolved to `public`/`queuert_`/`uuid`, plus the `queuert_migration` table and its six rows. |
| `v0.15.1.data.sql.gz`   | `pg_dump --data-only --inserts --disable-triggers` of `queuert_job` and `queuert_job_blocker`: 9,801 jobs and 3,000 blockers covering every job state.                                                         |
| `v0.15.1.manifest.json` | Applied migration names, row counts, per-status counts, and sentinel row ids the spec asserts against.                                                                                                         |

**These fixtures cannot be regenerated.** The migrations that produced them were deleted when the
lineage was collapsed to a single install; v0.15.1 is the oldest schema the current code accepts, and
`renameLegacySchemaAside` rejects anything older. Treat the files as frozen inputs. `v0.15.1.schema.sql` was verified byte-equivalent to `migrateTo("20260617000000_blocker_composite_pk")`
— columns, indexes, storage parameters, constraint names, and the `queuert_job_status` enum — before
the legacy migrations were removed.
