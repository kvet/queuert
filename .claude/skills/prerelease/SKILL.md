---
name: prerelease
description: Prepare a prerelease bundle of the Queuert packages for testers — prebuilt package tarballs at a prerelease version, release notes, a migration guide, and standalone examples when needed, all in one folder archived as a single .tgz. Use when someone needs to try unreleased changes without publishing to npm.
---

# Prerelease

Build a self-contained bundle that a tester can unpack and install from, without anything being published. Nothing in this skill commits, tags, pushes or publishes.

The bundle looks like this:

```
.prerelease/queuert-<version>/
├── README.md          # what this is, how to install, how to run the examples
├── RELEASE_NOTES.md
├── MIGRATION.md       # only when the release has breaking changes
├── packages/          # one pnpm-packed tarball per public package
└── examples/          # only when needed; standalone projects installing from ../../packages
.prerelease/queuert-<version>.tgz
```

`.prerelease/` is gitignored.

## Step 1: Pick the version

1. Check the working tree and find the last release:

```bash
git status -s
git describe --tags --abbrev=0
git log $(git describe --tags --abbrev=0)..HEAD --oneline
ls .changeset/*.md | grep -v README.md
```

Changes under `.claude/` and to `.gitignore` do not affect the bundle; ignore them (`git status -s -- . ':!.claude' ':!.gitignore'`). If anything else is dirty, tell the user the bundle would not match any commit and ask whether to continue. If they continue, add `.dirty` to the version below.

2. Read the frontmatter of every pending changeset and take the highest bump. Compute the target version from the last tag the way the `release` skill does: below `1.0.0`, `major` and `minor` both bump the minor (`0.16.0` → `0.17.0`) and `patch` bumps the patch.

3. The prerelease version is `<target>-pre.<YYYYMMDD>.g<short-sha>`, for example `0.17.0-pre.20261105.gfc51d73`. Use `date +%Y%m%d` and `git rev-parse --short HEAD`. Tell the user the version and continue.

Set `BUNDLE=.prerelease/queuert-<version>` for the steps below.

## Step 2: Build and pack

```bash
node .claude/skills/prerelease/pack.mjs --version <version> --out $BUNDLE > $BUNDLE.pack.log 2>&1; echo "exit=$?"
```

Create `.prerelease/` first if it does not exist. The script:

- stamps the version into every public `packages/*/package.json`, runs `pnpm build`, and runs `pnpm pack` per package into `$BUNDLE/packages/` (pnpm applies `publishConfig` and turns `workspace:*` into the exact prerelease version);
- restores the manifests with `git checkout`, also on failure;
- checks each tarball has the version, `dist/`, no `workspace:` ranges and no `./src` exports;
- installs every tarball into a fresh npm project in a temp dir and imports each package.

If it exits non-zero, read the tail of the log, fix the cause (or report it to the user) and re-run. Afterwards confirm `git status -s` shows no changes under `packages/`. Delete the log once it passes.

## Step 3: Release notes

Write `$BUNDLE/RELEASE_NOTES.md` from the pending changesets. Read every one in full, and read `git log <last-tag>..HEAD` to spot user-facing changes no changeset covers.

- Start with the version, the commit (`git rev-parse HEAD`), the date, and one line saying this is an unpublished prerelease for testing.
- Then `## Breaking Changes`, `## Features`, `## Fixes` (drop empty sections), each a list of changes described from a user's perspective. Keep the substance of the changesets; merge and reword so related entries read as one change, but do not invent details.
- End with `## Packages` listing every package in the bundle at the prerelease version.
- Do not include internal changes (refactors, tests, CI, docs-only).

If commits have user-facing changes that no changeset covers, list them to the user at the end instead of writing them into the notes.

## Step 4: Migration guide

Skip this step if no pending changeset is `major` and the notes have no breaking changes.

Write `$BUNDLE/MIGRATION.md`: a guide from the last release to this one that a user can follow top to bottom.

1. Read the breaking changesets, then the source for each change (`git diff <last-tag>..HEAD -- packages/*/src` for the relevant files), and the docs pages that describe the area — [How It Works](docs/src/content/docs/how-it-works/) and the [Integrations](docs/src/content/docs/integrations/) page of each affected adapter.
2. Order the guide the way a user meets the changes:
   - **Before you upgrade** — anything that has to happen before new code runs (for example stopping every process on the old version before a schema migration).
   - **Update dependencies** — install all `queuert` packages from the bundle together; adapters peer-depend on the exact `queuert` prerelease version.
   - **Database migrations** — what each new migration does to existing data, and on which adapters.
   - **Code changes** — one subsection per breaking change, each with a short before/after code snippet. Take the "before" code from the last release (`git show <last-tag>:<path>` for source, examples and docs), not from memory.
   - **Custom adapters** — interface changes for anyone implementing `StateAdapter` / `NotifyAdapter` themselves, if any.
3. Check every identifier, option name and type parameter in the guide against the built declaration files in the tarballs — the guide must not name anything that does not exist in this build. Most types live in hashed chunks (`client-*.d.mts`, `state-adapter-*.d.mts`), not `index.d.mts`, so extract all of them and grep: `mkdir -p $TMP/<pkg> && tar -xzf $BUNDLE/packages/<file>.tgz -C $TMP/<pkg> package/dist`, then `grep -rn '<name>' $TMP/*/package/dist --include='*.d.mts'`. A removed identifier is the exception: confirm it existed at the last tag instead (`git grep -n '<name>' <last-tag> -- packages`).

## Step 5: Examples (when needed)

Add examples when the release changes how users write code — new APIs, breaking changes to setup, a new adapter. Skip this step for fix-only releases. Pick at most three existing `examples/*` that show the changed areas best, preferring ones that need no Docker (SQLite with `node:sqlite`, in-process notify). Tell the user which ones you picked.

The examples in the repo depend on the workspace, so each one has to become a standalone project in `$BUNDLE/examples/<example-name>/`:

- Copy `src/` without `*.spec.ts` and `*.node-test.ts` files, plus the example's `README.md` if it has one. Rewrite the README's run instructions for the bundle: `npm install` / `npm start` instead of `pnpm --filter`, and only scripts that exist in the new `package.json`.
- Write a `package.json` with `"type": "module"`, `"private": true`, a `start` script (`tsx src/index.ts`), queuert packages as `file:../../packages/<tarball>.tgz`, third-party dependencies at the exact versions the example uses, and `tsx`, `typescript`, `@types/node` as devDependencies at the root `package.json` versions.
- Write a `tsconfig.json` with the `compilerOptions` of [packages-internal/tsconfig/base.json](packages-internal/tsconfig/base.json) inlined, without `composite`.
- Replace imports from other workspace examples (for example `example-state-postgres-drizzle/provider`) by copying that file into `src/` and importing it relatively. When two copied files share a name, name them by role (`state-provider.ts`, `notify-provider.ts`).
- Replace `@queuert/testcontainers` (`acquirePostgres`, `acquireRedis`, ...) with a connection string read from an environment variable (`DATABASE_URL`, `REDIS_URL`, `NATS_URL`), and say which one the example needs in the bundle README.
- No import may remain from a private workspace package (`private: true` in `packages-internal/*` or `examples/*`), including in copied files. Switch it to the public package that re-exports the name (for example `RuntimeType` from `@queuert/postgres` instead of `@queuert/typed-sql`), or inline the code. Check with `grep -rn "from \"@queuert/\|from \"example-" src`.
- If the example only passes on fresh state (its assertions fail on a second run against the same database), say so in its README.

Verify every example outside the repo, so the repo's `node_modules` cannot hide a missing dependency:

```bash
TMP=$(mktemp -d) && cp -R $BUNDLE $TMP/
cd $TMP/queuert-<version>/examples/<example-name>
npm install --no-audit --no-fund; echo "install=$?"
npx tsc --noEmit; echo "tsc=$?"
npm start; echo "start=$?"
```

Run the three commands separately so each exit code is visible.

Provide the environment variables the example needs (start a container with `docker run` if necessary). Fix the example until it type-checks and runs, mirroring each fix back into `$BUNDLE`, then remove `$TMP`. Do not leave `node_modules` or lockfiles in `$BUNDLE`.

## Step 6: Bundle README

Write `$BUNDLE/README.md`:

- What this is: the prerelease version, the commit, and that it is not published to npm.
- What is inside, linking `RELEASE_NOTES.md`, `MIGRATION.md` and each example.
- How to install: `npm install` (or `pnpm add`) with paths to the tarballs, always including `queuert` alongside any adapter, for example `npm install ./packages/queuert-<version>.tgz ./packages/queuert-postgres-<version>.tgz`.
- How to run each example and which environment variables it needs.
- Where to report problems: https://github.com/kvet/queuert/issues, mentioning the prerelease version.

## Step 7: Archive

```bash
tar -czf .prerelease/queuert-<version>.tgz -C .prerelease queuert-<version>
tar -tzf .prerelease/queuert-<version>.tgz
```

Check the listing has no `node_modules`, lockfiles or logs.

## Step 8: Report

Tell the user:

- the archive path and the folder path (absolute);
- the version and commit;
- which examples were included, or why none were;
- user-facing commits that no changeset covers, if any;
- anything that failed or was skipped.
