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
    ├── /api/*     → seroval API (reads from state adapter)
    ├── /assets/*  → Pre-built SolidJS assets
    └── otherwise  → SPA index.html
```

The dashboard accepts a Queuert `Client` instance and returns a `{ fetch }` object compatible with any server that handles the Web Fetch API (`Request` → `Response`).

## API Endpoints

All API endpoints are read-only except `POST /api/jobs/{jobId}/reschedule` and `DELETE /api/chains/{chainId}`. They query the state adapter through the Queuert client.

### Chain Endpoints

**`GET /api/chain-types`** — List the distinct chain type names in the store.

**`GET /api/chain-types/counts?typeNames=…`** — Capped running and completed counts per chain type.

**`GET /api/chains`** — List chains of one `typeName` with filtering and cursor-based pagination; returns an empty page without a `typeName`.

**`GET /api/chains/{chainId}`** — Get chain detail with the first page of its job sequence and, for a running chain, its current (tail) job as `currentJob` (`null` once the chain completes).

**`GET /api/chains/{chainId}/jobs`** — Paginate through jobs in a chain.

**`GET /api/chains/{chainId}/blocking`** — List jobs from other chains that depend on this chain as a blocker.

**`GET /api/chains/by-ids?ids=…`** — Look up chains of any type by ID; missing IDs are omitted. At most 100 IDs per request (more is a 400).

### Job Endpoints

**`GET /api/job-types`** — List the distinct job type names in the store.

**`GET /api/job-types/counts?typeNames=…`** — Capped blocked, pending, running and completed counts per job type, and `liveWorkerCount`, the number of workers with a live lease that process it.

**`GET /api/jobs`** — List jobs of one `typeName` with filtering and cursor-based pagination; returns an empty page without a `typeName`.

**`GET /api/jobs/{jobId}`** — Get job detail with continuation and blockers.

**`GET /api/jobs/by-ids?ids=…`** — Look up jobs of any type by ID; missing IDs are omitted. At most 100 IDs per request (more is a 400).

**`POST /api/jobs/{jobId}/reschedule`** — Reschedule a pending job to run now.

### Worker Endpoints

**`GET /api/workers`** — List every worker, ordered by `startedAt`; with `typeName`, only the workers that process it.

**`GET /api/workers/{workerId}`** — Get one worker as `{ worker }`, or a 404 `{ error: "Worker not found" }` when it has no row.

**`GET /api/workers/{workerId}/jobs`** — List every job running under the worker, ordered by `attemptAt`, whether or not the worker still has a row.

Worker IDs come from `generateWorkerId` and may be any string, so the frontend encodes the `{workerId}` segment with `encodeURIComponent` and the routes decode it. Worker IDs are `text` in every adapter, so these routes never hit a cast error and skip the malformed-ID probe.

### Chain Mutation Endpoints

**`DELETE /api/chains/{chainId}`** — Delete a chain and all its jobs. Returns 409 when the chain is still a blocker of a job in another chain; nothing is deleted.

### Malformed IDs and Errors

Core validates IDs only when it creates them, so an ID that does not fit the store's ID column (e.g. `junk` against a PostgreSQL `uuid`) makes the adapter throw a cast error on lookup. The dashboard treats that as "not found": when a lookup throws, it runs a cheap probe (`listChainTypeNames`). If the probe succeeds the database is healthy and the ID was malformed, so the handler returns a 404 (`Chain not found` / `Job not found`); if the probe fails too, the original error stands. This applies to chain detail, chain jobs, blocking, delete, job detail and reschedule; the chain jobs and blocking lists still return an empty page for a well-formed ID that matches no chain. Reschedule treats any error other than not-found or not-reschedulable the same way, but first looks the job up: if the job exists, the original error stands. The by-ids endpoints first try the batch lookup, then fall back to looking up each ID on its own (at most 8 at a time), counting an ID whose lookup throws as not found; if every lookup throws, the same probe decides between an empty result and the original error.

Any other error thrown by an `/api/*` handler becomes a `500` with a seroval `{ error }` body, the same shape as the handlers' 4xx responses. The probe cannot tell a malformed ID from a query-specific failure (e.g. a statement timeout) while the database stays reachable, so such a failure on a lookup reads as "not found" too. An `/api` path or method that matches no route (only `DELETE /api/chains/:id` and `POST /api/jobs/:id/reschedule` write; everything else is `GET`) returns a `404` with `{ error: "Not found" }`.

### Asset Serving

**`GET /assets/*`** — Serves pre-built frontend assets (JavaScript, CSS) with appropriate content types.

**`GET /`** (and all other non-API paths) — Serves the SPA `index.html` with a dynamically injected `<base>` tag matching the configured `basePath`. This enables client-side routing to work correctly behind reverse proxies.

## Query Performance

Listing queries route to status-specific partial indexes based on the `status` and `orderBy` combination. Each status filter is served by a status-specific partial index; sorts that index doesn't cover (e.g. running jobs by `createdAt`) add a sort step.

## Frontend

The frontend is a SolidJS single-page application built with Vite.

### Views

**Overview** (`/`) — For chains and for jobs, a stacked bar of the totals per status across all types with every status listed, and the five busiest types of each kind: chain types by running chains, job types by unfinished (blocked, pending and running) jobs. Types with none of that work are left out, and each row shows a chip for every status with a non-zero count. A Workers box shows the worker count, running jobs out of the combined concurrency, the number of lost leases, and how many job types have pending jobs and no live worker.

**Chain Types** (`/chains/types`) and **Job Types** (`/jobs/types`) — Every type by name, with a chip for each non-zero capped per-status count; a chip opens the list filtered by that status. The status filter (`status`, the same control as the lists, counting the types with anything in each status) narrows the page to the types with that status and shows only its chip. Each job type also shows its live worker count, linking to the worker list, with a warning icon when the type has pending jobs and no live worker.

**Chain List** (`/chains?typeName=…`) — The chains of one type, with a filter bar holding the status filter (`status`), and a chain-role select (`independent`) next to the status-dependent sort. Without a `typeName` it shows the chain types as a picker.

**Chain Detail** (`/chains/:id`) — The chain's current job and its status next to the chain status while the chain runs, since a running chain may be waiting on a blocked or pending job. The jobs of the chain, oldest first and loaded a page at a time as you scroll, with per-job blockers, each job's input (and, for the tail job, its output) on demand, folded runs of repeated completed jobs, the chain input and output, and the blocked jobs list (jobs in other chains that declared this chain as a blocker, linked to the job). Deleting the chain is refused up front while that list has entries.

**Job List** (`/jobs?typeName=…`) — The jobs of one type, with a filter bar holding the status filter (`status`) and the per-status sort options. A running job links to its worker. Without a `typeName` it shows the job types as a picker.

**Job Detail** (`/jobs/:id`) — The job's details (attempts, timing, the current attempt's worker linked to its page and start time, or who completed it), its last error, input, output or continuation, and its blockers. A pending job scheduled in the future gets a "Run now" action.

**Worker List** (`/workers`) — Every worker, oldest first, with a job type select (`typeName`). Each row shows the name, ID, running jobs out of its concurrency, start time and job types, with a warning icon once the lease is lost.

**Worker Detail** (`/workers/:id`) — The worker's name, ID, start time, lease end, concurrency, running job count and job types, a notice when its lease is lost, and its running jobs. A worker with no row shows as not found, with the jobs still running under it listed below.

**Find** (`/find?ids=…`) — The chains and jobs matching up to 100 IDs, across all types. Old `/chains?ids=` and `/jobs?ids=` links redirect here. The `⌘K` dialog in the top bar also suggests up to five chain types and five job types by name; `↓` moves into them, and picking one, or pressing `Enter` when the text is no chain or job ID, opens that type's list.

### Derived State

The UI shows only what the API returns, and derives the rest in pure helpers under `src/frontend/domain/`:

- **Job phase** — a job's `status` plus the fields that matter for display: `rescheduledAfterError` (pending with a `lastAttemptError`), `scheduled` / `due` (pending, by `scheduledAt`), `continued` / `tail` (completed, by `continuedToId`). The status pill always shows the real status; the phase only drives parts of job detail and the chain detail sequence. List rows stay minimal: status, ID, chain, a running job's worker, a time, and one-line input and output previews, with a warning icon on a job whose last attempt failed. There is no failed state, and no attempt number is ever attached to `lastAttemptError`, because it belongs to _some_ earlier attempt.
- **Job folding** — three or more consecutive completed jobs of the same type that continued and had no blockers collapse into one item. Re-run over the whole loaded sequence after each page.
- **Type matching** — fzf-style (v1 algorithm) scoring of type names for the find dialog: whitespace-separated terms must all match with their letters in order, in any term order, case-insensitively unless a term has an uppercase letter; ranked by score (word-start and consecutive-letter bonuses, gap penalties), then the shorter name, then input order.
- **Lease** — a worker has lost its lease once `leaseUntil` is no later than the page's clock, which ticks while the page is open.
- **Stranded type** — a job type with pending jobs and no live worker.
- **Counts** — the per-status counts are capped by the state adapter's `countCap` (10,000 by default), so a sum that includes a capped count is a lower bound (`≥`), and a capped count itself is shown with a trailing `+` (e.g. `10,000+`).

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
