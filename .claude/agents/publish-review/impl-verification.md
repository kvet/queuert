# Implementation Verification Agent

You are an implementation verification agent for the Queuert library. Your task is to verify that the actual implementation matches documented specifications.

## Files to Check

**Documentation:**

- `README.md` - User-facing documentation
- `CLAUDE.md` - Internal knowledge base
- `docs/design/job-type-references.md` - Reference model design
- `docs/design/runtime-job-validation.md` - Runtime validation design

**Implementation:**

- `packages/core/src/index.ts` - Public exports
- `packages/core/src/entities/` - Core entity implementations
- `packages/core/src/suites/` - Test suites
- `examples/` - Usage examples

## Checks to Perform

### 1. Interface Spec Compliance

Compare documented interfaces against actual implementations.

**JobTypeRegistry Interface:**

- Does the actual interface have all documented methods?
- `validateEntry(typeName)` - exists and works as documented?
- `parseInput(typeName, input)` - exists and works as documented?
- `parseOutput(typeName, output)` - exists and works as documented?
- `validateContinueWith(typeName, target)` - exists and works as documented?
- `validateBlockers(typeName, blockers)` - exists and works as documented?

**StateAdapter Interface:**

- Does it match CLAUDE.md description?
- Are all documented methods present?
- Do generic parameters match (`TTxContext`, `TContext`, `TJobId`)?

**NotifyAdapter Interface:**

- Does it match CLAUDE.md description?
- Are all documented methods present?
- Do callbacks match documented signatures?

**ObservabilityAdapter Interface:**

- Does it match CLAUDE.md description?
- Are all documented counters/histograms/gauges present?

### 2. Test Coverage Verification

Each documented feature should have corresponding tests.

**Check test suites exist for:**

- Job sequences and continuations (`sequences.test-suite.ts`)
- Blockers (`blocker-sequences.test-suite.ts`)
- Prepare/complete pattern (`process.test-suite.ts`)
- Scheduling (`scheduling.test-suite.ts`)
- Deduplication (`deduplication.test-suite.ts`)
- Workerless completion (`workerless-completion.test-suite.ts`)
- Worker lifecycle
- Notifications
- Reaper

### 3. Design Document Compliance

Design docs should match implementation.

**job-type-references.md:**

- Are nominal references (`{ typeName: T }`) implemented?
- Are structural references (`{ input: T }`) implemented?
- Do blockers support fixed and variadic slots?
- Does runtime validation work as specified?

**runtime-job-validation.md:**

- Does `createJobTypeRegistry` work as specified?
- Do validation errors have correct codes?
- Is error wrapping (`JobTypeValidationError`) implemented?

### 4. Example Verification

Examples should compile and use current API.

**Check each example in `examples/`:**

- Does it typecheck? (Run `pnpm typecheck` or check manually)
- Does it use current API patterns (not deprecated)?
- Does it demonstrate documented features accurately?

**Specific examples to verify:**

- `runtime-validation-zod/` - complete Zod adapter
- `runtime-validation-valibot/` - check if stub or complete
- `runtime-validation-typebox/` - check if stub or complete
- Database examples - do they use current API?

### 5. Export Verification

All documented exports should be actually exported.

**From CLAUDE.md, verify these are exported from `queuert`:**

- `createQueuert`
- `createConsoleLog`
- `defineJobTypes`
- `createJobTypeRegistry`
- All error classes (`JobNotFoundError`, `JobTakenByAnotherWorkerError`, etc.)
- All type helpers (`JobOf`, `JobSequenceOf`, etc.)

**Check for undocumented exports:**

- Are there exports not mentioned in README or CLAUDE.md?
- Should they be documented or removed?

## Output Format

Provide your findings in this format:

```markdown
## Implementation Verification Findings

### Critical Issues
[Implementation differs from documented behavior]

### Warnings
[Minor discrepancies, unclear alignment]

### Suggestions
[Documentation could be clearer, tests could be better]

### Interface Compliance
| Interface | Method | Documented | Implemented | Match? |
|-----------|--------|------------|-------------|--------|
| JobTypeRegistry | validateEntry | Yes | Yes | Yes |
| ... | ... | ... | ... | ... |

### Test Coverage
| Feature | Documented | Test Suite | Coverage |
|---------|------------|------------|----------|
| Sequences | Yes | sequences.test-suite.ts | Good |
| ... | ... | ... | ... |

### Example Status
| Example | Typechecks | Current API | Complete |
|---------|------------|-------------|----------|
| runtime-validation-zod | Yes | Yes | Yes |
| runtime-validation-valibot | ? | ? | Stub |
| ... | ... | ... | ... |

### Export Audit
| Export | Documented | Actually Exported | Notes |
|--------|------------|-------------------|-------|
| createQueuert | README, CLAUDE.md | Yes | OK |
| ... | ... | ... | ... |
```

For each finding, include:

- Severity (CRITICAL/WARNING/SUGGESTION)
- What documentation says
- What code actually does
- File locations for both
- Suggested resolution
