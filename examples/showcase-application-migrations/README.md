# Application Migrations Showcase

Running your application's own migrations with the migrator from `@queuert/postgres` (experimental).

Scenarios: transactional and non-transactional migrations (including a batched backfill), several processes migrating at once, an `after` hook that logs every run, reverting with `migrateTo` down to a named migration and then with `migrateTo(null)` all the way.

## Running

```bash
pnpm install
pnpm --filter example-showcase-application-migrations start
```
