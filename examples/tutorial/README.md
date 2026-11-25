# Tutorial

The exercises behind the [Learn](https://kvet.github.io/queuert/learn/) section of the docs. Each lesson in `src/<lesson>/` is embedded by its docs page with `<TryIt lesson="<lesson>">`, which the remark step in `docs/plugins/mdx.ts` turns into an exercise (`docs/plugins/exercise.ts` reads the lesson's files) that runs in the browser:

- `start/` — the files the reader starts from
- `solution/` — the same files, solved; **Solve** loads them
- `check.ts` — exports `check(run)`, which throws a hint unless the reader's run solved the lesson

Every lesson keeps its state in the in-process state adapter, so it runs in a browser worker with no database. The docs spec `docs/src/components/tutorial/exercises.spec.ts` runs every lesson the way the browser does and fails unless its solution passes its check and its start does not.

`src/hero.ts` is the chain shown in the home page hero.

## Running

```bash
pnpm install
pnpm --filter example-tutorial start
node examples/tutorial/src/first-chain/solution/index.ts
```
