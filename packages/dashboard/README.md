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

Read-only only - no mutations (retry, cancel, delete).

## Requirements

- Node.js 22 or later

## Installation

```bash
npm install @queuert/dashboard
```

**Peer dependencies:** `queuert`

The state adapter must implement the dashboard listing methods (`listChains`, `listJobs`, `getJobsBlockedByChain`). The PostgreSQL, SQLite, and in-memory adapters all support these.

## Quick Start

```typescript
import { createClient, createConsoleLog, defineJobTypes } from "queuert";
import { createPgStateAdapter } from "@queuert/postgres";
import { createDashboard } from "@queuert/dashboard";

const jobTypes = defineJobTypes<{
  "send-email": { entry: true; input: { to: string }; output: { sent: true } };
}>();

const stateAdapter = await createPgStateAdapter({ stateProvider: myPgProvider });

const client = await createClient({
  stateAdapter,
  registry: jobTypes,
  log: createConsoleLog(),
});

const dashboard = createDashboard({ client });

// Use with any server that accepts a fetch handler
serve({ fetch: dashboard.fetch, port: 3000 });
```

The dashboard serves both the API and pre-built SolidJS frontend from the same `fetch` handler. Mount it at any path - the frontend adapts to the mount point automatically.

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

## Exports

### Main (`.`)

- `createDashboard` - Factory to create the dashboard fetch handler

## Documentation

For full documentation, examples, and API reference, see the [main Queuert README](https://github.com/kvet/queuert#readme).

See also: [Dashboard Design](https://github.com/kvet/queuert/blob/main/docs/design/dashboard.md)
