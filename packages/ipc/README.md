# @queuert/ipc

[![npm version](https://img.shields.io/npm/v/@queuert/ipc.svg)](https://www.npmjs.com/package/@queuert/ipc)
![experimental](https://img.shields.io/badge/status-experimental-orange.svg)
[![license](https://img.shields.io/github/license/kvet/queuert.svg)](https://github.com/kvet/queuert/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/kvet/queuert.svg)](https://github.com/kvet/queuert)
[![last commit](https://img.shields.io/github/last-commit/kvet/queuert.svg)](https://github.com/kvet/queuert/commits)

> **Experimental** — API may change between minor versions.

IPC notify adapter for [Queuert](https://github.com/kvet/queuert) — a job-chain library: durable, typed background work in your database. It delivers notifications between processes on one host, such as a web process and a worker process sharing one SQLite database, without a Redis or NATS server.

## Installation

```bash
npm install @queuert/ipc
# or
pnpm add @queuert/ipc
# or
yarn add @queuert/ipc
```

**Peer dependencies:** `queuert`

## Documentation

- [Notify Adapters Guide](https://kvet.github.io/queuert/integrations/notify-adapters/ipc/)
- [API Reference](https://kvet.github.io/queuert/api/ipc/readme/)
- [Full Documentation](https://kvet.github.io/queuert/)
