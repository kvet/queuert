---
name: flaky-tests
description: Identify flaky tests by running tests multiple times and analyzing intermittent failures. Use when investigating test reliability.
argument-hint: "[runs] [--filter=pattern]"
disable-model-invocation: true
allowed-tools: Bash(pnpm *), Bash(mkdir *), Bash(grep *), Bash(cat *)
---

# Flaky Test Detection

Run the test suite multiple times sequentially and identify tests that exhibit intermittent behavior (sometimes pass, sometimes fail). This helps identify unreliable tests that may cause CI failures.

## Arguments

Parse `$ARGUMENTS` as follows:

- First numeric argument: number of runs (default: 10)
- Additional arguments: passed directly to the test command (e.g., `--filter`, `-t`)

Examples:

- `/flaky-tests` → 10 runs with `pnpm test --run`
- `/flaky-tests 5` → 5 runs
- `/flaky-tests 20 --filter=worker` → 20 runs with filter

## Process

### Step 1: Setup

Create a scratchpad directory for temporary log files:

```bash
SCRATCHPAD="$TMPDIR/flaky-tests-$(date +%s)"
mkdir -p "$SCRATCHPAD"
```

### Step 2: Run Tests Sequentially

IMPORTANT: Tests MUST be run sequentially (one at a time), NOT in parallel. Running tests in parallel can cause resource contention that creates false flakiness signals.

For each run (1 to N):

1. Execute `pnpm test --run` with any additional arguments
2. Capture the full output to `$SCRATCHPAD/test-run-$i.log`
3. Record the exit code
4. Report progress: "Run X/N: PASSED" or "Run X/N: FAILED"

Use a single bash command with a for loop:

```bash
for i in {1..N}; do
  echo "=== Test Run $i ==="
  pnpm test --run [extra args] 2>&1 | tee "$SCRATCHPAD/test-run-$i.log"
  if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo "Run $i: PASSED"
  else
    echo "Run $i: FAILED"
  fi
done
```

### Step 3: Parse Results

For each run, extract from the log files:

- Failed test names with their full path (file > suite > test name)
- Error messages for failed tests
- Test duration (to identify slow tests that may timeout)

Look for patterns in vitest output:

- `✓` or `√` = passed
- `×` or `✗` = failed
- `↓` = skipped
- `FAIL` prefix in summary = failed test file with suite path

### Step 4: Analyze Flakiness

Categorize tests by reliability:

| Category                 | Definition                                                           |
| ------------------------ | -------------------------------------------------------------------- |
| **Flaky**                | Failed in some runs but passed in others (0 < failures < total runs) |
| **Consistently Failing** | Failed in ALL runs                                                   |
| **Consistently Passing** | Passed in ALL runs                                                   |
| **Slow**                 | Tests taking >1000ms that may be prone to timeouts                   |

For flaky tests, calculate:

- Failure rate (failures / total runs)
- Which runs failed
- Error patterns (timeout, assertion, exception)

### Step 5: Generate Report

Provide a structured report with all flaky tests, their failure rates, and any observable patterns.

## Output Format

```markdown
# Flaky Test Report

## Summary

- **Total Runs**: X
- **Runs Passed**: Y (Z%)
- **Runs Failed**: W (V%)
- **Flaky Tests Found**: N

## Flaky Tests

Tests that passed in some runs but failed in others:

| Test              | Failures | Rate | Package      |
| ----------------- | -------- | ---- | ------------ |
| Suite > test name | X/Y      | Z%   | package-name |

### Detailed Analysis

#### [Test Name]

- **File**: path/to/test.spec.ts
- **Failure Rate**: X/Y runs (Z%)
- **Failed in Runs**: 2, 5, 8
- **Error Pattern**: [timeout | assertion | exception]
- **Sample Error**:
```

[First error message encountered]

```

## Consistently Failing Tests

Tests that failed in ALL runs (not flaky, just broken):

| Test | Package | Error Type |
|------|---------|------------|
| Suite > test name | package-name | timeout/assertion |

## Slow Tests (Potential Timeout Risk)

Tests taking >1000ms that may be prone to flakiness:

| Test | Avg Duration | Package |
|------|--------------|---------|
| Suite > test name | Xms | package-name |

## Run-by-Run Summary

| Run | Status | Failed Tests |
|-----|--------|--------------|
| 1 | PASS | - |
| 2 | FAIL | test-a, test-b |
| ... | ... | ... |

## Recommendations

[Suggestions for addressing the flakiness, such as:]
- Tests with timeout errors: Consider increasing timeout or optimizing
- Tests with ordering issues: May have race conditions
- Tests with assertion errors: May depend on execution order or shared state
```

## Severity Definitions

- **HIGH**: Failure rate > 50% - Test is unreliable and likely to cause CI failures
- **MEDIUM**: Failure rate 20-50% - Test occasionally fails, should be investigated
- **LOW**: Failure rate < 20% - Rare failures, lower priority to fix

## Common Causes of Flakiness

After identifying flaky tests, investigate these common causes:

1. **Race conditions**: Async operations completing in different orders
2. **Shared state**: Tests depending on or modifying global state
3. **Timeouts**: Tests too slow for their timeout limits
4. **Resource contention**: Database connections, file handles, ports
5. **Non-deterministic ordering**: Tests assuming specific execution order
6. **Time-dependent logic**: Tests using real time instead of mocked time
