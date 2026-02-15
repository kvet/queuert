---
name: publish-review
description: Run a comprehensive review of the Queuert library before publishing, launching 5 parallel agents to check documentation coherence, API design, implementation verification, feature completeness, and API consistency. Use when preparing to publish or validating publish readiness.
---

# Publish Readiness Review

Run a comprehensive review of the Queuert library before publishing. This skill launches 5 specialized review agents in parallel to check different aspects of publish readiness.

## Instructions

When this skill is invoked, you MUST:

1. Launch all 5 review agents IN PARALLEL using the Task tool with a single message containing 5 tool calls
2. Wait for all agents to complete
3. Write a combined report to `docs/publish-readiness-report.md`
4. Display a summary of findings in the conversation

## Agents to Launch

Launch these 5 agents in parallel using the Task tool (all in one message with 5 Task tool calls):

### 1. Documentation Coherence Agent

```
subagent_type: general-purpose
description: Review docs coherence
prompt: |
  You are a documentation coherence reviewer for the Queuert library.

  First, read the detailed instructions in .claude/agents/publish-review/docs-coherence.md

  Then review all documentation for coherence and consistency:
  - README.md - User-facing overview
  - CLAUDE.md - Index to design docs and packages
  - docs/design/*.md - Design documents (design decisions)
  - packages/*/README.md - Package READMEs (API documentation)

  Check for:
  1. Terminology consistency across all docs
  2. Feature parity between design docs and package READMEs
  3. Code example accuracy (syntax, current API)
  4. Cross-reference integrity (valid links/paths)
  5. Completeness gaps (exports not documented in package READMEs)

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

  Then review the public API for design issues:
  - packages/core/src/index.ts - Main exports
  - packages/*/src/index.ts - All package exports

  Check for:
  1. Async/Sync factory consistency (I/O should be async)
  2. Naming conventions (create* pattern, casing)
  3. Generic parameter patterns
  4. Error class design
  5. Configuration patterns
  6. Return type consistency
  7. Potential footguns

  Known item to investigate: createOtelObservabilityAdapter is sync while other adapters are async.

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

  Then verify implementation matches documentation:
  - Compare design docs claims against actual code
  - Compare package README exports against actual exports
  - Verify test suites exist for documented features
  - Check examples compile and use current API
  - Verify all exports documented in package READMEs are actually exported

  Focus on:
  1. JobTypeRegistry interface compliance
  2. StateAdapter interface compliance
  3. NotifyAdapter interface compliance
  4. Example verification (especially runtime-validation-* examples)
  5. Export audit

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

  Then identify undercooked features and missing functionality:
  - Review TODO.md for publish-blocking items
  - Search test suites for skipped tests or TODOs
  - Check examples for stub implementations
  - Verify package.json files have required fields

  Check for:
  1. TODO.md items that block publish
  2. Skipped tests without explanation
  3. Incomplete examples (especially runtime-validation-valibot, runtime-validation-typebox)
  4. Missing package.json fields (files, exports)
  5. Code TODOs/FIXMEs in implementation

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

  Then ensure consistent patterns across all packages:
  - Compare all packages/*/src/index.ts exports
  - Compare adapter implementations
  - Compare testing exports

  Check for:
  1. State adapter consistency (Postgres, SQLite)
  2. Notify adapter consistency (Postgres, Redis, NATS)
  3. Configuration option naming (channelPrefix vs subjectPrefix)
  4. Factory pattern consistency
  5. Testing export patterns (extendWith* naming)
  6. Re-export patterns

  Categorize findings as CRITICAL, WARNING, or SUGGESTION.
  Return a structured report with recommendations for standardization.
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
