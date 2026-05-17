---
name: publish-review
description: Run a comprehensive review of the Queuert library before publishing, launching 10 parallel agents to check documentation coherence, API design, implementation verification, feature completeness, API consistency, schema design, code style, benchmarks, changeset coverage, and OTEL semantic conventions. Use when preparing to publish or validating publish readiness.
---

# Publish Readiness Review

Run a comprehensive review of the Queuert library before publishing. This skill launches 10 specialized review agents in parallel to check different aspects of publish readiness.

## Instructions

When this skill is invoked, you MUST:

1. Launch all 10 review agents IN PARALLEL using the Task tool with a single message containing 10 tool calls
2. Wait for all agents to complete
3. Write a combined report to `docs/publish-readiness-report.md`
4. Display a summary of findings in the conversation

## Agents to Launch

Launch these 10 agents in parallel using the Task tool (all in one message with 10 Task tool calls):

### 1. Documentation Coherence Agent

```
subagent_type: general-purpose
description: Review docs coherence
prompt: |
  You are a documentation coherence reviewer for the Queuert library.

  First, read the detailed instructions in .claude/agents/publish-review/docs-coherence.md

  Then review all documentation for coherence and consistency:
  - TSDoc on all public exports in packages/*/src/**/*.ts (primary API documentation)
  - README.md - User-facing overview
  - CLAUDE.md - Session instructions (workflow requirements, high-level links)
  - docs/src/content/docs/advanced/*.md - Reference documents (architectural, defer to TSDoc for API signatures)
  - packages/*/README.md - Package READMEs (API documentation)

  Check for:
  1. Terminology consistency across all docs
  2. Feature parity between design docs, TSDoc, and package READMEs
  3. Code example accuracy (syntax, current API)
  4. Cross-reference integrity (valid links/paths)
  5. Completeness gaps (exports missing TSDoc or not documented in package READMEs)

  Categorize findings as CRITICAL, WARNING, or SUGGESTION.
  Return a structured report with specific file locations.
```

### 2. API Design Review Agent

```
subagent_type: general-purpose
description: Review API design
prompt: |
  You are an API design reviewer for the Queuert library.

  First, read the detailed instructions in .claude/agents/publish-review/api-design.md

  Then review the public API across all packages/*/src/index.ts for design issues,
  following the checks described in the instructions file.

  Categorize findings as CRITICAL, WARNING, or SUGGESTION.
  Return a structured report.
```

### 3. Implementation Verification Agent

```
subagent_type: general-purpose
description: Verify implementation
prompt: |
  You are an implementation verification agent for the Queuert library.

  First, read the detailed instructions in .claude/agents/publish-review/impl-verification.md

  Then verify implementation matches documentation by following the checks
  described in the instructions file: export audit, interface compliance,
  design doc compliance, test coverage, and example verification.

  Categorize findings as CRITICAL, WARNING, or SUGGESTION.
  Return a structured report.
```

### 4. Feature Completeness Agent

```
subagent_type: general-purpose
description: Check feature completeness
prompt: |
  You are a feature completeness auditor for the Queuert library.

  First, read the detailed instructions in .claude/agents/publish-review/feature-completeness.md

  Then identify undercooked features and missing functionality by following
  the checks described in the instructions file: TODO.md audit, test health,
  example completeness, package readiness, and feature gaps.

  Categorize findings as CRITICAL, WARNING, or SUGGESTION.
  Return a structured report.
```

### 5. API Consistency Agent

```
subagent_type: general-purpose
description: Check API consistency
prompt: |
  You are an API consistency reviewer for the Queuert library.

  First, read the detailed instructions in .claude/agents/publish-review/api-consistency.md

  Then ensure consistent patterns across all packages by following the checks
  described in the instructions file: cross-package patterns, configuration,
  lifecycle, type exports, testing exports, error handling, and re-exports.

  Categorize findings as CRITICAL, WARNING, or SUGGESTION.
  Return a structured report with recommendations for standardization.
```

### 6. Schema Review Agent

```
subagent_type: general-purpose
description: Review schema design
prompt: |
  You are a database schema reviewer for the Queuert library.

  First, read the detailed instructions in .claude/agents/publish-review/schema-review.md

  Then review the state adapter schema design across PostgreSQL and SQLite by
  following the checks described in the instructions file: index coverage,
  normalization, query efficiency, cross-backend consistency, forward-compatibility,
  locking/concurrency, and data integrity.

  Categorize findings as CRITICAL, WARNING, or SUGGESTION.
  Return a structured report.
```

### 7. Code Style Agent

```
subagent_type: general-purpose
description: Review code style
prompt: |
  You are a code style reviewer for the Queuert library.

  First, read the detailed instructions in .claude/agents/publish-review/code-style.md

  Then verify the codebase follows conventions from code-style.md by
  following the checks described in the instructions file: function declaration style,
  unnecessary async wrapping, redundant types, comment quality, nullable conventions,
  error class usage, and naming conventions.

  Categorize findings as CRITICAL, WARNING, or SUGGESTION.
  Return a structured report.
```

### 8. Benchmarks Agent

```
subagent_type: general-purpose
description: Run benchmarks
prompt: |
  You are a benchmarks runner for the Queuert library.

  Run `pnpm benchmarks` from the repository root to execute all benchmarks
  (memory footprint and type complexity).

  Report:
  1. Whether all benchmarks ran successfully
  2. Any errors or failures encountered
  3. Notable results or regressions compared to values documented in
     docs/src/content/docs/integrations/benchmarks.md

  Categorize findings as CRITICAL, WARNING, or SUGGESTION.
  Return a structured report.
```

### 9. Changeset Coverage Agent

```
subagent_type: general-purpose
description: Verify changeset coverage
prompt: |
  You are a changeset coverage auditor for the Queuert library.

  Goal: verify that every user-facing change pending for the next release is
  covered by a `.changeset/*.md` entry, and that each entry is well-formed.

  Steps:

  1. List the pending changeset files: every `.md` file under `.changeset/` other
     than `README.md`. Read each one — capture the frontmatter (which packages
     are bumped and at what level) and the body (description, any migration
     notes).

  2. Determine the diff range to audit. The last published state is whatever
     was tagged on `main`. Use:
        git fetch origin main --tags
        git log -1 --pretty=%H origin/main   # or the latest release tag
     and diff that against `HEAD`. List every changed file with `git diff
     --name-status <base>..HEAD`.

  3. Classify each changed file as user-facing or internal-only:
     - **User-facing**: anything under `packages/*/src/**` that affects the
       public API, runtime behavior, or wire/schema format; new or changed
       migrations under `packages/*/src/state-adapter/sql.ts`; changes to
       `packages/*/src/index.ts` exports; package.json `exports`,
       `dependencies`, `peerDependencies`, or `version`.
     - **Internal-only**: tests (`*.test.ts`, `*.spec.ts`, suites), types-only
       tightening, doc-only edits (`docs/`, `*.md` outside `.changeset/`),
       build/CI/tooling, `benchmarks/`, `examples/`, comment tweaks.

  4. For every user-facing change, verify a changeset entry covers it:
     - The affected package appears in some changeset's frontmatter.
     - The bump level is appropriate (major for breaking API/behavior/schema
       removals or renames; minor for additive changes; patch for bug fixes).
     - Schema/migration changes are explicitly mentioned in the body, with
       guidance on what runs against existing databases.
     - Breaking changes include migration guidance.

  5. Flag any of the following:
     - **CRITICAL**: User-facing change with no changeset for its package; a
       breaking change shipped without a major bump; a schema migration with
       no mention in any changeset body.
     - **WARNING**: Changeset present but body is sparse or written for the
       author rather than users; bump level looks too low for the change;
       multiple changesets fragmenting one logical release; affected package
       missing from frontmatter despite being touched in user-facing ways.
     - **SUGGESTION**: Wording, ordering, formatting, or consolidation
       improvements to the existing changeset bodies.

  Return a structured report with:
  - The set of pending changesets and what each one covers (one bullet per
    file).
  - The set of user-facing files in the diff and which changeset (if any)
    covers each.
  - Findings categorized CRITICAL / WARNING / SUGGESTION with specific file
    paths and remediation.
```

### 10. OTEL Semantic Conventions Agent

```
subagent_type: general-purpose
description: Review OTEL conventions
prompt: |
  You are an OpenTelemetry semantic conventions reviewer for the Queuert library.

  First, read the detailed instructions in .claude/agents/publish-review/otel-conventions.md

  Then review the OTEL observability adapter against the official OTEL semantic
  conventions (messaging spans/metrics/attributes, general attribute naming,
  metric naming and units, error attributes). Cross-check what the adapter
  emits against what is documented in docs/src/content/docs/advanced/otel-metrics.md
  and packages/otel/README.md.

  Use WebFetch to consult the spec pages listed in the instructions file when
  you need to verify a specific convention — do not invent rules.

  Categorize findings as CRITICAL, WARNING, or SUGGESTION.
  Return a structured report with specific file paths, line numbers, and the
  spec section that justifies each call.
```

## Report Format

After all agents complete, write the combined report to `docs/publish-readiness-report.md` with this structure:

```markdown
# Queuert Publish Readiness Review

Generated: [current date]

## Summary

- Critical Issues: [count]
- Warnings: [count]
- Suggestions: [count]

## 1. Documentation Coherence

[Agent 1 findings]

## 2. API Design

[Agent 2 findings]

## 3. Implementation Verification

[Agent 3 findings]

## 4. Feature Completeness

[Agent 4 findings]

## 5. API Consistency

[Agent 5 findings]

## 6. Schema Review

[Agent 6 findings]

## 7. Code Style

[Agent 7 findings]

## 8. Benchmarks

[Agent 8 findings]

## 9. Changeset Coverage

[Agent 9 findings]

## 10. OTEL Semantic Conventions

[Agent 10 findings]

## Action Items

### Must Fix Before Publish

[All CRITICAL items from all agents]

### Should Fix

[All WARNING items from all agents]

### Consider for Future

[All SUGGESTION items from all agents]
```

## Known Accepted Items (Ignore List)

The following items have been reviewed and accepted as intentional design decisions. Agents should NOT flag these:

- **`createOtelObservabilityAdapter` is async**: Reserves the right to add async initialization later. Accepted.
- **`helpersSymbol` exported publicly but marked `@internal`**: Required by `@queuert/dashboard` and `createInProcessWorker`. The `@internal` annotation is a convention, not enforcement. Accepted.
- **`createAsyncRwLock` re-exported from `@queuert/sqlite` via `queuert/internal`**: SQLite users need this for transaction serialization. Accepted.
- **`createClient` is async but performs no I/O**: Reserves the right to add async initialization later. Accepted.
- **`createInProcessWorker` is async but performs no I/O**: Reserves the right to add async initialization later. Accepted.
- **`$idType` phantom property on `createPgStateAdapter` options**: Intentional pattern for generic type inference. Accepted.
- **`HookNotRegisteredError` does not accept `cause`**: This error is never caused by another error. Accepted.
- **Notify adapter channel prefix uses different separators**: Each adapter uses its transport's idiomatic separator (`:` for Redis, `_` for PG, `.` for NATS). Accepted.
- **`testing` export declared in `publishConfig` but files excluded**: Testing utilities are workspace-only, not shipped to npm. The `publishConfig.exports` entry is overridden by the `files` exclusion. Accepted.
- **NATS notify adapter lacks provider abstraction**: NATS is experimental. A provider abstraction will be added when the API stabilizes. Accepted.
- **NATS package exports no types from index.ts**: NATS is experimental. Types will be exported when the API stabilizes. Accepted.
- **NATS notify adapter uses `nc`/`kv` instead of `provider`**: NATS is experimental. Will standardize to provider pattern when API stabilizes. Accepted.
- **NATS notify adapter uses `subjectPrefix` while PG and Redis use `channelPrefix`**: Each adapter uses its transport's idiomatic terminology. Accepted.
- **State adapter factory options differ between PG and SQLite for ID generation**: Intentional — each adapter uses the most natural approach for its database (`idDefault` SQL expression for PG, `idGenerator` JS function for SQLite). Accepted.
- **`TransactionContextRequiredError` does not accept `cause`**: This error signals API misuse (calling mutating methods without `withTransaction`), never caused by another error. Accepted.
- **OTEL `workerError` does not record error details**: Counter attributes should remain low-cardinality per OTEL best practices. Error details are captured via the Log adapter. Accepted.
- **`getNextJobAvailableInMsSql` uses `FOR UPDATE SKIP LOCKED`**: Tracked in TODO.md for future cleanup. Accepted for now.
- **SQLite `checkExternalBlockerRefsSql` lacks row locking**: SQLite serializes writes via exclusive transaction locking, providing equivalent safety. Accepted.
- **`listJobChains` status filter applies post-join**: Acceptable for dashboard queries with pagination. A denormalized chain status column can be added if performance becomes an issue. Accepted.
- **SQLite `createJobs` performs per-job queries (O(n) round-trips)**: Documented and accepted SQLite trade-off. Tracked in TODO.md. Accepted.
- **SQLite `addJobsBlockers` performs per-job-blocker-group loop (O(n) round-trips)**: Same accepted SQLite trade-off. Tracked in TODO.md. Accepted.
- **Package READMEs are minimal**: Package READMEs link to the docs site for API documentation. This is the intended pattern. Accepted.

## Severity Definitions

- **CRITICAL**: Must fix before publish (breaking inconsistency, docs lie about behavior, missing critical export)
- **WARNING**: Should fix (minor inconsistencies, unclear docs, suboptimal patterns)
- **SUGGESTION**: Nice to have (style improvements, additional docs, polish)
