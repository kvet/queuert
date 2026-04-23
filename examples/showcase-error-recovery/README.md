# Error Recovery Showcase

Queuert's engine-level error recovery guarantees.

Scenarios: CHECK constraint violation inside complete, handler throws after `await complete()`, staged-mode failure between prepare and complete, `lastAttemptError` inspection on retry.

## Running

```bash
bun install
bun run --filter example-showcase-error-recovery start
```
