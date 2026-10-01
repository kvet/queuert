---
title: Dashboard Internals
description: API endpoints, SolidJS frontend, and deployment architecture of the dashboard.
sidebar:
  order: 15
---

## Overview

This document describes the internal implementation of `@queuert/dashboard` — its API layer, frontend architecture, and how it integrates with the Queuert client. The dashboard is a self-contained web application that ships as a single fetch handler with pre-built frontend assets embedded in the package.

## Architecture

```
HTTP Request
    ↓
await createDashboard({ client, basePath })
    ↓
fetch(request) → Response
    ├── /api/*     → JSON API (reads from state adapter)
    └── /assets/*  → Pre-built SolidJS SPA
```

The dashboard accepts a Queuert `Client` instance and returns a `{ fetch }` object compatible with any server that handles the Web Fetch API (`Request` → `Response`).

## API Endpoints

All API endpoints are read-only except `POST /api/jobs/{jobId}/reschedule` and `DELETE /api/chains/{chainId}`. They query the state adapter through the Queuert client.

### Chain Endpoints

**`GET /api/chain-types`** — List the distinct chain type names in the store.

**`GET /api/chain-types/counts?typeNames=…`** — Capped running and completed counts per chain type.

**`GET /api/chains`** — List chains of one `typeName` with filtering and cursor-based pagination; returns an empty page without a `typeName`.

**`GET /api/chains/{chainId}`** — Get chain detail with the first page of its job sequence.

**`GET /api/chains/{chainId}/jobs`** — Paginate through jobs in a chain.

**`GET /api/chains/{chainId}/blocking`** — List jobs from other chains that depend on this chain as a blocker.

### Job Endpoints

**`GET /api/job-types`** — List the distinct job type names in the store.

**`GET /api/job-types/counts?typeNames=…`** — Capped blocked, pending, running and completed counts per job type.

**`GET /api/jobs`** — List jobs of one `typeName` with filtering and cursor-based pagination; returns an empty page without a `typeName`.

**`GET /api/jobs/{jobId}`** — Get job detail with continuation and blockers.

**`POST /api/jobs/{jobId}/reschedule`** — Reschedule a pending job to run now.

### Chain Mutation Endpoints

**`DELETE /api/chains/{chainId}`** — Delete a chain and all its jobs. Returns 409 when the chain is still a blocker of a job in another chain; nothing is deleted.

### Asset Serving

**`GET /assets/*`** — Serves pre-built frontend assets (JavaScript, CSS) with appropriate content types.

**`GET /`** (and all non-API paths) — Serves the SPA `index.html` with a dynamically injected `<base>` tag matching the configured `basePath`. This enables client-side routing to work correctly behind reverse proxies.

## Query Performance

Listing queries route to status-specific partial indexes based on the `status` and `orderBy` combination. No special filtering guidance is needed — all status + sort combinations are index-backed.

## Frontend

The frontend is a SolidJS single-page application built with Vite.

### Views

**Chain Types** (`/chains/types`) — Default view (`/` redirects here). Lists every chain type with its running and completed counts; picking a type opens the chain list filtered to it.

**Job Types** (`/jobs/types`) — Lists every job type with its blocked, pending, running and completed counts; picking a type or a count opens the job list filtered to it.

**Chain List** (`/chains`) — Lists the chains of one selected type, newest first by default. Each chain displays as a card with type name, chain ID, status badge, date, and input preview. Supports lookup by chain ID and filtering by type name and status, with a status-dependent order-by dropdown and a direction toggle.

**Chain Detail** (`/chains/:id`) — The job sequence within a chain, loaded a page at a time as you scroll. Shows each job as a card with input/output JSON, blocker dependencies with links to blocker chains, and a "Blocking" section listing jobs from other chains that depend on this chain.

**Job List** (`/jobs`) — Cross-chain view of individual jobs with the same filtering and scroll-driven pagination patterns as the chain list.

**Job Detail** (`/jobs/:id`) — Detailed job view with status, timing information, worker/attempt details, blockers, input/output data, continuation link, and error details. Shows a "Reschedule" button for pending jobs scheduled in the future.

### Build and Embedding

The frontend is compiled during package build, not at deploy time:

1. Vite compiles the SolidJS app to static assets in `dist/frontend/`
2. A build plugin reads the compiled assets and generates a TypeScript file (`assets.generated.ts`) containing all assets as string constants
3. The backend build (tsdown) bundles everything — including the embedded assets — into a single distributable file

This means the published package requires no frontend build tools, no `node_modules` for the frontend, and no separate static file serving. The entire dashboard is a single JavaScript module.

## basePath Support

The `basePath` option enables mounting the dashboard at a sub-path behind a reverse proxy or framework router:

```typescript
const dashboard = await createDashboard({
  client,
  basePath: "/internal/queuert",
});
```

The dashboard injects a `<base href="{basePath}/">` tag into the HTML response, which tells the SolidJS router to prefix all routes with the base path. API requests from the frontend are also prefixed accordingly.

## See Also

- [Dashboard Reference](/queuert/api/dashboard/readme/) — Configuration and API
- [Adapter Architecture](../adapters/) — State adapter design
