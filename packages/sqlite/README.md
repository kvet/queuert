# @queuert/sqlite

[![npm version](https://img.shields.io/npm/v/@queuert/sqlite.svg)](https://www.npmjs.com/package/@queuert/sqlite)
![experimental](https://img.shields.io/badge/status-experimental-orange.svg)
[![license](https://img.shields.io/github/license/kvet/queuert.svg)](https://github.com/kvet/queuert/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/kvet/queuert.svg)](https://github.com/kvet/queuert)
[![last commit](https://img.shields.io/github/last-commit/kvet/queuert.svg)](https://github.com/kvet/queuert/commits)

> **Experimental** — API may change between minor versions. For production use, consider [@queuert/postgres](https://github.com/kvet/queuert/tree/main/packages/postgres).

SQLite state adapter for [Queuert](https://github.com/kvet/queuert) — a TypeScript library for database-backed job queues.

## Installation

```bash
npm install @queuert/sqlite
# or
pnpm add @queuert/sqlite
# or
yarn add @queuert/sqlite
```

**Peer dependencies:** `queuert`

## Testing custom providers

Validate a custom `SqliteStateProvider` against Queuert's conformance suite using the framework-agnostic runner from [`queuert/conformance`](https://kvet.github.io/queuert/reference/queuert/conformance/). See the [Testing Custom Adapters guide](https://kvet.github.io/queuert/advanced/custom-adapters/).

## Documentation

- [State Adapters Guide](https://kvet.github.io/queuert/integrations/state-adapters/)
- [API Reference](https://kvet.github.io/queuert/reference/sqlite/)
- [Full Documentation](https://kvet.github.io/queuert/)
