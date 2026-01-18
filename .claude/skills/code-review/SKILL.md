---
name: code-review
description: Run a comprehensive code review of local changes, analyzing staged and unstaged changes to provide insights, identify issues, and suggest alternative approaches. Use when reviewing code before committing or creating pull requests.
---

# Local Code Review

Run a comprehensive, critical code review of local changes. This skill analyzes staged and unstaged changes to provide insights, identify issues, and suggest alternative approaches.

## Instructions

When this skill is invoked:

1. First, read the detailed agent instructions from `.claude/agents/code-review/instructions.md`
2. Gather the current changes using git diff
3. Analyze the changes following the review framework
4. Provide a structured report with findings and alternatives

## Usage

```
/code-review              # Review all uncommitted changes
/code-review --staged     # Review only staged changes
/code-review <commit>     # Review changes in a specific commit
/code-review <base>..<head>  # Review changes between commits
```

## Review Process

### Step 1: Gather Changes

Based on arguments:

- No args: `git diff HEAD` (all uncommitted changes)
- `--staged`: `git diff --staged`
- `<commit>`: `git show <commit>`
- `<base>..<head>`: `git diff <base>..<head>`

### Step 2: Understand Context

For each modified file:

- Read the full file to understand surrounding context
- Identify the module/component's purpose
- Note existing patterns and conventions

### Step 3: Analyze Changes

Apply the review framework from `.claude/agents/code-review/instructions.md`:

- Correctness analysis
- Design evaluation
- Security review
- Performance considerations
- Maintainability assessment

### Step 4: Generate Alternatives

For non-trivial changes, brainstorm alternative approaches:

- Different architectural patterns
- Alternative algorithms or data structures
- Trade-off analysis for each approach

### Step 5: Report

Provide a structured report with:

1. Executive summary
2. Critical issues (must fix)
3. Concerns (should consider)
4. Suggestions (nice to have)
5. Alternative approaches with trade-offs
6. Questions for the author

## Output Format

```markdown
# Code Review: [brief description of changes]

## Summary
[2-3 sentence overview of what the changes do and overall assessment]

## Critical Issues
[Issues that would cause bugs, security vulnerabilities, or data loss]

## Concerns
[Design issues, edge cases, potential problems]

## Suggestions
[Improvements, style, minor issues]

## Alternative Approaches

### Alternative 1: [Name]
**Approach:** [Description]
**Trade-offs:**
- Pro: ...
- Con: ...
**When to prefer:** [Conditions where this is better]

### Alternative 2: [Name]
...

## Questions
[Clarifying questions for the author about intent or requirements]
```

## Severity Definitions

- **CRITICAL**: Bugs, security issues, data loss risks, breaking changes
- **CONCERN**: Design flaws, missing edge cases, unclear intent, potential issues
- **SUGGESTION**: Style, readability, minor optimizations, documentation
