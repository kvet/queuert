# Timeouts Showcase

Demonstrates timeout patterns for job processing.

## Scenarios

1. **Cooperative Timeout**: Using `AbortSignal.timeout()` with the job signal
2. **Hard Timeout**: Using `leaseConfig` for automatic job reclamation

## Running

```bash
pnpm install
pnpm start
```
