# Error Recovery Showcase

Demonstrates Queuert's engine-level error recovery guarantees.

## Scenarios

1. **Constraint Violation in Complete**: CHECK constraint fires, savepoint rolls back, job retries
2. **Error After Complete**: Handler throws after `await complete()`, completion is rolled back
3. **Error Between Prepare and Complete (Staged)**: External call fails, prepare committed, job retries
4. **lastAttemptError Inspection**: Previous error available on retry with serialization

## Running

```bash
pnpm install
pnpm start
```
