---
name: release
description: Create a release for the Queuert monorepo. Guides through changeset creation, version bumping, committing, merging dev to main, tagging, and creating a GitHub prerelease.
---

# Release

Create a release for the Queuert monorepo using changesets.

## Instructions

When this skill is invoked, follow these steps in order. Ask the user for input where indicated.

### Step 1: Check Prerequisites

1. Verify you are on the `dev` branch with a clean working tree:

```bash
git branch --show-current
git status -s
```

If not on `dev` or working tree is dirty, inform the user and stop.

2. Check for pending changesets:

```bash
ls .changeset/*.md 2>/dev/null | grep -v README.md || echo "No pending changesets"
```

3. Show commits since last release:

```bash
git log main..dev --oneline
```

If there are no commits, inform the user there is nothing to release.

### Step 2: Analyze Changes and Create Changeset

1. **Launch a background agent** to analyze all changes since the last release. The agent should:

```
subagent_type: general-purpose
description: Analyze release changes
run_in_background: false
prompt: |
  Analyze all changes between main and dev branches for the Queuert monorepo release.

  Run: git log main..dev --oneline
  Then for each commit, run: git show <hash> --stat and git show <hash> to understand the full change.

  Produce a structured report:

  1. **User-facing changes** (features, fixes, improvements that affect library consumers)
     - Group by package where relevant
     - Describe the change from a user's perspective, not implementation details
  2. **Internal changes** (refactors, CI, docs, chore — not for the changeset summary but useful context)
  3. **Breaking changes** (if any)
  4. **Suggested version bump** (patch/minor/major) with reasoning
  5. **Suggested changeset summary** — a concise, user-facing description of what changed.
     Only include things users care about. Do NOT mention internal chores, CI changes,
     or refactors that don't affect the public API.
```

2. Present the agent's analysis to the user. **Ask the user**:
   - What version bump they want (suggest the agent's recommendation as default)
   - Whether the suggested changeset summary is good, or if they want to adjust it

3. Create the changeset file at `.changeset/release-<version>.md`. All packages are linked and must be listed together:

```markdown
---
"queuert": <bump>
"@queuert/postgres": <bump>
"@queuert/sqlite": <bump>
"@queuert/redis": <bump>
"@queuert/nats": <bump>
"@queuert/otel": <bump>
"@queuert/dashboard": <bump>
---

<release summary>
```

### Step 3: Version Packages

Run changeset version (must use `pnpm run` to avoid the built-in `pnpm version`):

```bash
pnpm run version
```

Verify all packages were bumped to the expected version:

```bash
ls packages/*/package.json | xargs -I {} sh -c 'echo "--- {}"; grep "\"version\"" {}'
```

### Step 4: Format

Changeset-generated changelogs may have formatting issues. Run the formatter:

```bash
pnpm fmt
```

### Step 5: Commit, Merge, Tag, and Push

All in sequence:

1. Stage and commit on `dev`:

```bash
git add . && git commit -m "chore: release v<version>"
```

**IMPORTANT**: Do NOT add a Co-Authored-By line.

2. Merge dev into main (fast-forward), tag, and push everything:

```bash
git checkout main
git merge dev --no-edit
git tag v<version>
git push origin main dev v<version>
git checkout dev
```

### Step 6: Create GitHub Release

Create a GitHub prerelease. Use the analysis from Step 2 to write thorough release notes with user-facing changes grouped by category. Do not include internal/chore changes.

```bash
gh release create v<version> --title "v<version>" --prerelease --notes "$(cat <<'EOF'
## What's Changed

### <Category> (e.g., Bug Fixes, Features, Improvements)

- <detailed bullet points from the Step 2 analysis>

### Packages

| Package | Version |
|---------|---------|
| `queuert` | <version> |
| `@queuert/postgres` | <version> |
| `@queuert/sqlite` | <version> |
| `@queuert/redis` | <version> |
| `@queuert/nats` | <version> |
| `@queuert/otel` | <version> |
| `@queuert/dashboard` | <version> |
EOF
)"
```

### Step 7: Monitor Publish

The tag push triggers `.github/workflows/publish.yaml` which publishes to npm. Watch for the result:

```bash
sleep 5 && gh run list --repo kvet/queuert --workflow publish.yaml --limit 1
```

Then watch the run:

```bash
gh run watch <run-id> --exit-status
```

If it succeeds, verify on npm:

```bash
npm view queuert versions --json | tail -5
```

If it fails, check logs with `gh run view <run-id> --log-failed` and help the user debug.
