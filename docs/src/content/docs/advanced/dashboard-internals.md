---
title: Dashboard Internals
description: API endpoints, SolidJS frontend, and deployment architecture of the dashboard.
sidebar:
  order: 14
---

## Overview

This document describes the internal implementation of `@queuert/dashboard` — its API layer, frontend architecture, and how it integrates with the Queuert client. The dashboard is a self-contained web application that ships as a single fetch handler with pre-built frontend assets embedded in the package.

## Architecture

```
HTTP Request
    ↓
createDashboard({ client, basePath })
    ↓
fetch(request) → Response
    ├── /api/*     → JSON API (reads from state adapter)
    └── /assets/*  → Pre-built SolidJS SPA
```

The dashboard accepts a Queuert `Client` instance and returns a `{ fetch }` object compatible with any server that handles the Web Fetch API (`Request` → `Response`).

## API Endpoints

All API endpoints are read-only except `POST /api/jobs/{jobId}/trigger`. They query the state adapter through the Queuert client.

### Chain Endpoints

**`GET /api/chains`** — List job chains with filtering and pagination.

| Parameter | Type | Description |
| --- | --- | --- |
| `typeName` | query | Filter by chain type name |
| `status` | query | Filter by status |
| `rootOnly` | query | Return only root jobs |
| `id` | query | Filter by chain ID |
| `jobId` | query | Filter by job ID within chain |
| `cursor` | query | Pagination cursor |
| `limit` | query | Page size |

Returns an array of `[rootJob, lastJob]` pairs and a `nextCursor` for pagination.

**`GET /api/chains/{chainId}`** — Get chain detail with full job sequence.

Returns the root job, last job, all jobs in the chain ordered by chain index, and a map of job blockers.

**`GET /api/chains/{chainId}/blocking`** — List jobs from other chains that depend on this chain as a blocker.

### Job Endpoints

**`GET /api/jobs`** — List individual jobs with filtering and pagination.

| Parameter | Type | Description |
| --- | --- | --- |
| `status` | query | Filter by status |
| `typeName` | query | Filter by job type name |
| `chainTypeName` | query | Filter by chain type name |
| `chainId` | query | Filter by chain ID |
| `id` | query | Filter by job ID |
| `cursor` | query | Pagination cursor |
| `limit` | query | Page size |

**`GET /api/jobs/{jobId}`** — Get job detail with continuation and blockers.

**`POST /api/jobs/{jobId}/trigger`** — Trigger a pending job scheduled for the future. Sets `scheduled_at` to now and notifies the notify adapter. Only works for jobs with status `pending`.

### Asset Serving

**`GET /assets/*`** — Serves pre-built frontend assets (JavaScript, CSS) with appropriate content types.

**`GET /`** (and all non-API paths) — Serves the SPA `index.html` with a dynamically injected `<base>` tag matching the configured `basePath`. This enables client-side routing to work correctly behind reverse proxies.

## Query Performance

The chain listing endpoint (`GET /api/chains`) joins each root row with the last job in the chain. Filtering by `status` is not optimized — it applies to the joined last job and cannot use an index. Always pass `typeName` to narrow the scan. See [Performance considerations](/queuert/guides/queries/#performance-considerations).

## Frontend

The frontend is a SolidJS single-page application built with Vite.

### Views

**Chain List** (`/`) — Default view showing all chains ordered by creation time (newest first). Each chain displays as a card with type name, chain ID, status badge, last job type, attempt count, and input preview. Supports filtering by chain ID, job ID, type name, and status. Includes cursor-based "Load more" pagination.

**Chain Detail** (`/chains/:id`) — Full job sequence within a chain. Shows each job as a card with input/output JSON, blocker dependencies with links to blocker chains, and a "Blocking" section listing jobs from other chains that depend on this chain.

**Job List** (`/jobs`) — Cross-chain view of individual jobs with the same filtering and pagination patterns as the chain list.

**Job Detail** (`/jobs/:id`) — Detailed job view with status, timing information, worker/lease details, blockers, input/output data, continuation link, and error details. Shows a "Trigger" button for pending jobs scheduled in the future.

### Build and Embedding

The frontend is compiled during package build, not at deploy time:

1. Vite compiles the SolidJS app to static assets in `dist/frontend/`
2. A build plugin reads the compiled assets and generates a TypeScript file (`assets.generated.ts`) containing all assets as string constants
3. The backend build (tsdown) bundles everything — including the embedded assets — into a single distributable file

This means the published package requires no frontend build tools, no `node_modules` for the frontend, and no separate static file serving. The entire dashboard is a single JavaScript module.

## basePath Support

The `basePath` option enables mounting the dashboard at a sub-path behind a reverse proxy or framework router:

```typescript
const dashboard = createDashboard({
  client,
  basePath: "/internal/queuert",
});
```

The dashboard injects a `<base href="{basePath}/">` tag into the HTML response, which tells the SolidJS router to prefix all routes with the base path. API requests from the frontend are also prefixed accordingly.

## See Also

- [Dashboard Reference](/queuert/reference/dashboard/) — Configuration and API
- [Adapter Architecture](../adapters/) — State adapter design
