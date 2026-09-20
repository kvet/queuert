# Migration fixtures

A queuert **v0.15.1** database, used by `src/specs/legacy-upgrade.spec.ts` to exercise the
upgrade path onto the current schema.

| File                    | Contents                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `v0.15.1.sqlite.gz`     | A complete SQLite database file (schema, data, and the three `queuert_migration` rows): 9,801 jobs and 3,000 blockers covering every job state. |
| `v0.15.1.manifest.json` | Applied migration names, row counts, per-status counts, and sentinel row ids the spec asserts against.                                          |

**These fixtures cannot be regenerated.** The migrations that produced them were deleted when the
lineage was collapsed to a single install; v0.15.1 is the oldest schema the current code accepts, and
`renameLegacySchemaAside` rejects anything older. Treat the files as frozen inputs.
