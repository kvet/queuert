---
name: commit-message
description: Generate a conventional commit message from staged changes. Analyzes changes to determine affected packages and appropriate commit type, then outputs a properly formatted commit message.
---

# Commit Message Generator

Generate a conventional commit message suitable for use with the changesets library. This skill analyzes your staged changes and creates a properly formatted commit message.

## Instructions

When this skill is invoked:

1. Analyze staged changes
2. Determine affected packages/scope
3. Generate a conventional commit message

## Usage

```
/commit-message         # Generate commit message from staged changes
```

## Process

### Step 1: Gather Changes

Run these commands to understand the changes:

```bash
git diff --staged --name-only
git diff --staged
```

If nothing is staged, inform the user they need to stage changes first.

### Step 2: Analyze Changes

Determine:

1. **Type** - What kind of change is this?
2. **Scope** - Which package(s) are affected?
3. **Description** - What does this change do?
4. **Breaking** - Is this a breaking change?

### Step 3: Map to Conventional Commit Types

| Type       | When to Use                                         | Semver Impact |
| ---------- | --------------------------------------------------- | ------------- |
| `feat`     | New feature or capability                           | minor         |
| `fix`      | Bug fix                                             | patch         |
| `refactor` | Code change that doesn't fix a bug or add a feature | patch         |
| `perf`     | Performance improvement                             | patch         |
| `docs`     | Documentation only                                  | none          |
| `chore`    | Maintenance, dependencies, configs                  | none          |
| `test`     | Adding or fixing tests                              | none          |
| `build`    | Build system or external dependencies               | none          |
| `ci`       | CI configuration                                    | none          |

### Step 4: Determine Scope

Map changed files to package scopes:

| Path Pattern           | Scope                     |
| ---------------------- | ------------------------- |
| `packages/core/**`     | `core`                    |
| `packages/postgres/**` | `postgres`                |
| `packages/sqlite/**`   | `sqlite`                  |
| `packages/mongodb/**`  | `mongodb`                 |
| `packages/redis/**`    | `redis`                   |
| `packages/nats/**`     | `nats`                    |
| `packages/otel/**`     | `otel` or `observability` |
| `examples/**`          | `examples`                |
| `docs/**`              | `docs`                    |

If multiple packages are affected equally, omit the scope or use the primary one.

### Step 5: Generate Commit Message

Format: `type(scope): description`

For breaking changes: `type(scope)!: description`

#### Rules

1. **Type**: lowercase, from the table above
2. **Scope**: lowercase, optional, in parentheses
3. **Description**:
   - Start with lowercase verb (add, fix, update, remove, change)
   - Use imperative mood ("add feature" not "added feature")
   - No period at the end
   - Max ~50 characters for the first line
4. **Breaking changes**: Add an exclamation mark before the colon (e.g., `feat!:`)

#### Examples from this project

```
feat(core): add JobTypeRegistry with compile-time and runtime validation
fix(core): prevent context leakage to independent chains during job processing
refactor: rename JobSequence to JobChain across entire codebase
refactor(core): simplify index.ts exports, move in-process adapters to internal
chore(examples): enable isolatedModules in all tsconfig files
docs: address publish readiness issues
feat(observability): add gauge metrics for worker idle/processing state
refactor!: change Log API from tuple args to named data/error properties
```

### Step 6: Output

Provide the commit message in a code block that can be easily copied:

```
feat(core): add new feature description
```

If the change is significant, also suggest whether a changeset file is needed:

- `feat` and `fix` changes to packages → changeset recommended
- `docs`, `chore`, `test` → usually no changeset needed

## Multi-line Commit Messages

For complex changes, provide an extended format:

```
type(scope): short description

Longer explanation of the change if needed.
Explain the motivation and contrast with previous behavior.

BREAKING CHANGE: description of what breaks (if applicable)
```
