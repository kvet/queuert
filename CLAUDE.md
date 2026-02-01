# Queuert Code Style Guide

## License

MIT License - see [LICENSE](LICENSE) for details.

## Design Documentation

High-level design decisions are documented in [docs/design/](docs/design/):

- [Job Chain Model](docs/design/job-chain-model.md) - Unified job/chain model, Promise analogy, terminology
- [Job Type References](docs/design/job-type-references.md) - Nominal/structural references, continueWith, blockers
- [Runtime Job Validation](docs/design/runtime-job-validation.md) - JobTypeRegistry, schema adapters (Zod, Valibot, TypeBox, ArkType)
- [Job Processing](docs/design/job-processing.md) - Prepare/complete pattern, timeouts, workerless completion
- [Deduplication](docs/design/deduplication.md) - Chain-level deduplication, continuation restriction
- [Adapters](docs/design/adapters.md) - Factory patterns, dual-context design, notification optimization
- [Code Style](docs/design/code-style.md) - Code conventions, testing patterns, project organization, examples structure
- [Worker](docs/design/worker.md) - Worker lifecycle, leasing, reaper, retry logic

## Packages

- `queuert` - Core abstractions and in-memory implementations
- `@queuert/postgres` - PostgreSQL state and notify adapters
- `@queuert/sqlite` - SQLite state adapter
- `@queuert/mongodb` - MongoDB state adapter
- `@queuert/redis` - Redis notify adapter
- `@queuert/nats` - NATS notify adapter with optional JetStream KV
- `@queuert/otel` - OpenTelemetry observability adapter
- `examples/` - Integration examples organized by prefix: `state-{state_adapter_name}-*`, `notify-{notify_adapter_name}-*`, `validation-*`, `log-*`, `observability-*`, `showcase-*`, `benchmark-*`

See each package's README.md for exports, configuration, and usage.

## Session Requirements

- No obvious comments
- Run `pnpm fmt` before running checks to fix formatting issues
- Run `pnpm check` to run all checks together (or separately: `pnpm lint`, `pnpm typecheck`, `pnpm test`)
- See [Code Style](docs/design/code-style.md) for testing patterns, documentation update guidelines, and examples naming conventions
- When creating or modifying examples, follow the naming convention and single-purpose design described in Code Style
