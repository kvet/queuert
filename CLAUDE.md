# Queuert Code Style Guide

## Session Requirements

- **Consult [reference docs](docs/src/content/docs/advanced/) before changes**: When modifying adapters, job processing, workers, or other core systems, read the corresponding reference doc first to understand architectural decisions that must be preserved
- No obvious comments
- Run `pnpm fmt` before running checks to fix formatting issues
- Run individual tests during development (e.g., `pnpm vitest run packages/core/src/specs/some.spec.ts`)
- Run `pnpm check` once the change is finalized to verify everything passes (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm examples`)
- See [Code Style](code-style.md) for testing patterns, documentation update guidelines, and examples naming conventions
- When creating or modifying examples, follow the naming convention and single-purpose design described in Code Style
- Remove todo items as soon as their work is done, whether completed directly or via sub-agents
