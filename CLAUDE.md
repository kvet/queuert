# Queuert Code Style Guide

## License

MIT License - see [LICENSE](LICENSE) for details.

## Design Documentation

**Before modifying core library behavior, read the relevant design doc in [docs/design/](docs/design/).** These documents capture architectural decisions that must be preserved.

## Packages

- `packages/` - Publishable packages
- `packages-internal/` - Internal packages
- `examples/` - Integration examples organized by prefix: `state-*`, `notify-*`, `validation-*`, `log-*`, `observability-*`, `showcase-*`, `benchmark-*`

## Session Requirements

- **Consult design docs before changes**: When modifying adapters, job processing, workers, or other core systems, read the corresponding design doc first to understand existing decisions
- No obvious comments
- Run `pnpm fmt` before running checks to fix formatting issues
- Run individual tests during development (e.g., `pnpm vitest run packages/core/src/specs/some.spec.ts`)
- Run `pnpm check` once the change is finalized to verify everything passes (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm examples`)
- See [Code Style](docs/design/code-style.md) for testing patterns, documentation update guidelines, and examples naming conventions
- When creating or modifying examples, follow the naming convention and single-purpose design described in Code Style
