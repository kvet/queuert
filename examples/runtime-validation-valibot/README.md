# Runtime Validation with Valibot Example

This example demonstrates how to use Valibot for runtime validation of job types.

## What it shows

1. Creating a Valibot-based job type registry adapter
2. Nominal reference validation (by type name)
3. Structural reference validation (by input shape)
4. Type inference from Valibot schemas for compile-time safety

## Key concepts

- **Nominal validation**: Validate continuations/blockers by type name (e.g., `v.literal("step2")`)
- **Structural validation**: Validate by input shape (e.g., any job with `{ token: string }` input)
- **Type inference**: TypeScript types are inferred from Valibot schemas automatically

## Key files

- `src/valibot-adapter.ts` - The Valibot adapter implementation (reusable in your projects)
- `src/index.ts` - Demo showing nominal and structural validation

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter @queuert/runtime-validation-valibot start
```
