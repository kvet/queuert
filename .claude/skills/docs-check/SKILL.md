---
name: docs-check
description: Check if documentation is up to date with code changes. Analyzes git changes and identifies documentation that may need updating, comparing code modifications against design docs and package READMEs.
---

# Documentation Sync Check

Analyze git changes to identify documentation that may need updating. This skill compares code modifications against design docs, package READMEs, and CLAUDE.md to ensure documentation stays in sync with the codebase.

## Instructions

When this skill is invoked:

1. Read the detailed agent instructions from `.claude/agents/docs-check/instructions.md`
2. Gather the current changes using git diff
3. Map code changes to relevant documentation
4. Analyze whether documentation needs updating
5. Provide a structured report with findings

## Usage

```
/docs-check              # Check all uncommitted changes
/docs-check --staged     # Check only staged changes
/docs-check <commit>     # Check changes in a specific commit
/docs-check <base>..<head>  # Check changes between commits
```

## Process

### Step 1: Gather Changes

Based on arguments:

- No args: `git diff HEAD` (all uncommitted changes)
- `--staged`: `git diff --staged`
- `<commit>`: `git show <commit>`
- `<base>..<head>`: `git diff <base>..<head>`

Also run `git diff --name-only` (with appropriate flags) to get the list of changed files.

### Step 2: Categorize Changed Files

Group changes by their documentation relevance:

| File Pattern               | Related Documentation                                    |
| -------------------------- | -------------------------------------------------------- |
| `packages/core/src/**`     | `docs/design/*.md`, `packages/core/README.md`            |
| `packages/postgres/**`     | `packages/postgres/README.md`, `docs/design/adapters.md` |
| `packages/sqlite/**`       | `packages/sqlite/README.md`, `docs/design/adapters.md`   |
| `packages/mongodb/**`      | `packages/mongodb/README.md`, `docs/design/adapters.md`  |
| `packages/redis/**`        | `packages/redis/README.md`, `docs/design/adapters.md`    |
| `packages/nats/**`         | `packages/nats/README.md`, `docs/design/adapters.md`     |
| `packages/otel/**`         | `packages/otel/README.md`, `docs/design/adapters.md`     |
| `examples/**`              | Package READMEs, `CLAUDE.md`                             |
| Worker-related changes     | `docs/design/worker.md`                                  |
| Job chain/sequence changes | `docs/design/job-chain-model.md`                         |
| Deduplication logic        | `docs/design/deduplication.md`                           |
| Job processing/timeouts    | `docs/design/job-processing.md`                          |
| Type references/blockers   | `docs/design/job-type-references.md`                     |
| Validation/registry        | `docs/design/runtime-job-validation.md`                  |
| Adapter interfaces         | `docs/design/adapters.md`                                |
| Exports/public API         | Package README.md, `CLAUDE.md`                           |

### Step 3: Analyze Documentation Impact

For each category of changes, determine:

1. **API Changes**: New exports, renamed functions, changed signatures
2. **Behavioral Changes**: Modified algorithms, new features, changed defaults
3. **Structural Changes**: New files, moved code, renamed modules
4. **Configuration Changes**: New options, changed config shapes

### Step 4: Check Documentation

Read relevant documentation files and compare against code changes:

- Are new features/APIs documented?
- Do examples still match the current API?
- Are behavioral descriptions still accurate?
- Is terminology consistent with code?

### Step 5: Generate Report

Provide a structured report categorizing findings by urgency.

## Output Format

```markdown
# Documentation Sync Check

## Summary
[Brief overview of changes and documentation status]

## Changes Analyzed
- [List of changed files grouped by area]

## Documentation Updates Required

### Must Update
[Documentation that is definitely out of sync - factually incorrect, missing new features, wrong API signatures]

### Should Review
[Documentation that may need updating - behavioral changes, new edge cases, terminology]

### Already Up to Date
[Documentation that was checked and appears current]

## Specific Recommendations

### [doc-file-path]
- **Issue**: [What's wrong or missing]
- **Code Reference**: [Which code change necessitates this]
- **Suggested Action**: [What to update]

## No Documentation Impact
[Changes that don't require documentation updates and why]
```

## Severity Definitions

- **MUST UPDATE**: Documentation is factually incorrect or missing critical information
  - Incorrect API signatures or examples
  - Missing documentation for new public APIs
  - Wrong behavioral descriptions

- **SHOULD REVIEW**: Documentation may be stale or incomplete
  - Changed default values or behaviors
  - New edge cases or limitations
  - Terminology drift

- **NO IMPACT**: Changes that don't affect documentation
  - Internal refactoring with no API changes
  - Test-only changes
  - Bug fixes that don't change documented behavior
