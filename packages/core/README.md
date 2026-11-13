# queuert

[![npm version](https://img.shields.io/npm/v/queuert.svg)](https://www.npmjs.com/package/queuert)
[![license](https://img.shields.io/github/license/kvet/queuert.svg)](https://github.com/kvet/queuert/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/kvet/queuert.svg)](https://github.com/kvet/queuert)
[![last commit](https://img.shields.io/github/last-commit/kvet/queuert.svg)](https://github.com/kvet/queuert/commits)

Core package for [Queuert](https://github.com/kvet/queuert) — a job-chain library: durable, typed background work in your database. Job chains compose like Promise chains, but they survive crashes and commit with your DB transactions.

## Installation

```bash
npm install queuert
# or
pnpm add queuert
# or
yarn add queuert
```

You also need a **state adapter** to store jobs:

- [`@queuert/postgres`](https://github.com/kvet/queuert/tree/main/packages/postgres) — PostgreSQL
- [`@queuert/sqlite`](https://github.com/kvet/queuert/tree/main/packages/sqlite) — SQLite
- [`@queuert/mysql`](https://github.com/kvet/queuert/tree/main/packages/mysql) — MySQL / MariaDB _(experimental)_
- [`@queuert/redis`](https://github.com/kvet/queuert/tree/main/packages/redis) — Redis _(experimental)_

Optional adapters:

- [`@queuert/postgres`](https://github.com/kvet/queuert/tree/main/packages/postgres) — PostgreSQL LISTEN/NOTIFY notify adapter
- [`@queuert/redis`](https://github.com/kvet/queuert/tree/main/packages/redis) — Redis notify adapter
- [`@queuert/nats`](https://github.com/kvet/queuert/tree/main/packages/nats) — NATS notify adapter _(experimental)_
- [`@queuert/otel`](https://github.com/kvet/queuert/tree/main/packages/otel) — OpenTelemetry observability (metrics and tracing)
- [`@queuert/dashboard`](https://github.com/kvet/queuert/tree/main/packages/dashboard) — Web dashboard for monitoring jobs

## Documentation

- [Getting Started](https://kvet.github.io/queuert/getting-started/introduction/)
- [API Reference](https://kvet.github.io/queuert/api/core/type-aliases/client/)
- [Full Documentation](https://kvet.github.io/queuert/)
