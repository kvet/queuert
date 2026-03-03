---
name: publish-review
description: Run a comprehensive review of the Queuert library before publishing, launching 7 parallel agents to check documentation coherence, API design, implementation verification, feature completeness, API consistency, schema design, and code style. Use when preparing to publish or validating publish readiness.
---

# Publish Readiness Review

Run a comprehensive review of the Queuert library before publishing. This skill launches 7 specialized review agents in parallel to check different aspects of publish readiness.

## Instructions

When this skill is invoked, you MUST:

1. Launch all 7 review agents IN PARALLEL using the Task tool with a single message containing 7 tool calls
2. Wait for all agents to complete
3. Write a combined report to `docs/publish-readiness-report.md`
4. Display a summary of findings in the conversation

## Agents to Launch

Launch these 7 agents in parallel using the Task tool (all in one message with 7 Task tool calls):

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

## Action Items

### Must Fix Before Publish

[All CRITICAL items from all agents]

### Should Fix

[All WARNING items from all agents]

### Consider for Future

[All SUGGESTION items from all agents]
```

## Severity Definitions

- **CRITICAL**: Must fix before publish (breaking inconsistency, docs lie about behavior, missing critical export)
- **WARNING**: Should fix (minor inconsistencies, unclear docs, suboptimal patterns)
- **SUGGESTION**: Nice to have (style improvements, additional docs, polish)
