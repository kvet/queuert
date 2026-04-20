# queuert

[![npm version](https://img.shields.io/npm/v/queuert.svg)](https://www.npmjs.com/package/queuert)
[![license](https://img.shields.io/github/license/kvet/queuert.svg)](https://github.com/kvet/queuert/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/kvet/queuert.svg)](https://github.com/kvet/queuert)
[![last commit](https://img.shields.io/github/last-commit/kvet/queuert.svg)](https://github.com/kvet/queuert/commits)

Core package for [Queuert](https://github.com/kvet/queuert) — a type-safe, database-backed job queue library for TypeScript.

## Installation

```bash
npm install queuert
# or
pnpm add queuert
# or
yarn add queuert
```

You also need a **state adapter** to store jobs:

- [`@queuert/postgres`](https://github.com/kvet/queuert/tree/main/packages/postgres) — PostgreSQL (recommended for production)
- [`@queuert/sqlite`](https://github.com/kvet/queuert/tree/main/packages/sqlite) — SQLite _(experimental)_
- `createInProcessStateAdapter` (built-in) — in-memory, single-process

Optional adapters:

- [`@queuert/redis`](https://github.com/kvet/queuert/tree/main/packages/redis) — Redis notify adapter (recommended for production)
- [`@queuert/nats`](https://github.com/kvet/queuert/tree/main/packages/nats) — NATS notify adapter _(experimental)_
- `createInProcessNotifyAdapter` (built-in) — in-memory, single-process
- [`@queuert/otel`](https://github.com/kvet/queuert/tree/main/packages/otel) — OpenTelemetry observability (metrics and tracing)
- [`@queuert/dashboard`](https://github.com/kvet/queuert/tree/main/packages/dashboard) — Web dashboard for monitoring jobs _(experimental)_

## Documentation

- [Getting Started](https://kvet.github.io/queuert/getting-started/introduction/)
- [API Reference](https://kvet.github.io/queuert/reference/queuert/client/)
- [Full Documentation](https://kvet.github.io/queuert/)
