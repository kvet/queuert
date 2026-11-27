# Tutorial

The exercises behind the [Learn](https://kvet.github.io/queuert/learn/) section of the docs. Each lesson in `src/<lesson>/` is embedded by its docs page with `<TryIt lesson="<lesson>">`, which the remark step in `docs/plugins/mdx.ts` turns into an exercise (`docs/plugins/exercise.ts` reads the lesson's files) that runs in the browser:

- `start/` — the files the reader starts from
- `solution/` — the same files, solved; **Solve** loads them
- `check.ts` — exports `check(run)`, which throws a hint unless the reader's run solved the lesson
- `db.ts` — re-exports `src/db/postgres.ts`, so the lesson runs under Node; the docs replace it with the database the reader picks

Every lesson runs on a real database: `src/db/postgres.ts` opens PostgreSQL in PGlite with the provider of the [`postgresql/state-pglite`](../postgresql/state-pglite/) example and `src/db/sqlite.ts` opens SQLite in sql.js with the provider of the [`sqlite/state-sql-js`](../sqlite/state-sql-js/) example, both in memory, so the lessons run in a browser worker with nothing to install. Each one applies Queuert's migration and returns the `stateAdapter` and a `sql` tagged template for the lesson's own tables, so a lesson's `index.ts` is the same on both. The docs spec `docs/src/components/tutorial/exercises.spec.ts` runs every lesson on both databases the way the browser does and fails unless its solution passes its check and its start does not.

`src/hero.ts` is the chain shown in the home page hero.

## Running

```bash
pnpm install
pnpm --filter example-tutorial start
node examples/tutorial/src/first-chain/solution/index.ts
```
