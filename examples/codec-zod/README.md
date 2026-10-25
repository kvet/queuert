# Bidirectional Codec with Zod

Zod 4 codec adapter — carries a `Date` through job inputs and outputs while storing it as an ISO string, so handlers and client reads see runtime types and the database stays JSON-safe.

## Running

```bash
pnpm install
pnpm --filter example-codec-zod start
```
