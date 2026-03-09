# @queuert/dashboard

[![npm version](https://img.shields.io/npm/v/@queuert/dashboard.svg)](https://www.npmjs.com/package/@queuert/dashboard)
[![license](https://img.shields.io/github/license/kvet/queuert.svg)](https://github.com/kvet/queuert/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/kvet/queuert.svg)](https://github.com/kvet/queuert)
[![last commit](https://img.shields.io/github/last-commit/kvet/queuert.svg)](https://github.com/kvet/queuert/commits)

> **Experimental** - API may change between minor versions.

Embeddable web dashboard for [Queuert](https://github.com/kvet/queuert) - a TypeScript library for database-backed job queues. Provides a read-only observation UI for listing, filtering, and inspecting job chains and jobs.

## What does this do?

A self-contained dashboard that mounts as a single `fetch` handler on your existing server. No external build steps, no runtime dependencies beyond `queuert`.

- **Chain list** - Browse chains with status badges, type filtering, and ID search
- **Chain detail** - Full job sequence, blocker relationships, and blocking chains
- **Job list** - Cross-chain job view with status/type filtering
- **Job detail** - Input/output data, error messages, lease info, continuation links

Read-only — no mutations (retry, cancel, delete).

## Requirements

- Node.js 22 or later

## Installation

```bash
npm install @queuert/dashboard
```

**Peer dependencies:** `queuert`

The state adapter must implement the dashboard listing methods (`listJobChains`, `listJobs`, `listBlockedJobs`). The PostgreSQL, SQLite, and in-memory adapters all support these.

## Quick Start

```typescript
import { createClient, createConsoleLog, defineJobTypeRegistry } from "queuert";
import { createPgStateAdapter } from "@queuert/postgres";
import { createDashboard } from "@queuert/dashboard";

const jobTypeRegistry = defineJobTypeRegistry<{
  "send-email": { entry: true; input: { to: string }; output: { sent: true } };
}>();

const stateAdapter = await createPgStateAdapter({ stateProvider: myPgProvider });

const client = await createClient({
  stateAdapter,
  registry: jobTypeRegistry,
  log: createConsoleLog(),
});

const dashboard = createDashboard({ client });

// Use with any server that accepts a fetch handler
serve({ fetch: dashboard.fetch, port: 3000 });
```

The dashboard serves both the API and pre-built SolidJS frontend from the same `fetch` handler.

## Sub-path mounting

When mounting the dashboard behind a reverse proxy or framework router at a sub-path, set `basePath` to the mount prefix:

```typescript
const dashboard = createDashboard({
  client,
  basePath: "/internal/queuert",
});
```

All routing, asset loading, and client-side navigation will use the configured base path. Omit `basePath` (or pass `''`) when mounting at the root.

## Authentication

The dashboard has no built-in auth. Add authentication middleware before the dashboard handler:

```typescript
const server = serve({
  fetch: (request) => {
    if (!isAuthorized(request)) return new Response("Unauthorized", { status: 401 });
    return dashboard.fetch(request);
  },
  port: 3000,
});
```

## API Reference

For the full API reference with types and signatures, see the [@queuert/dashboard reference](https://kvet.github.io/queuert/reference/dashboard/).

## Documentation

For full documentation and examples, see the [Queuert documentation](https://kvet.github.io/queuert/).
