# Dashboard Design

## Overview

The `@queuert/dashboard` package provides an embeddable web dashboard for observing job chains and jobs. It is a read-only observation platform — no mutations (retry, cancel, delete). Users can list, filter, sort, inspect chain/job details, and view blocker relationships.

The dashboard complements `@queuert/otel` (push-based metrics/traces to external backends) with a focused, embedded UI that queries the job state directly. Like OTEL, the dashboard is opt-in.

## Goals

- **Observation only**: List, filter, sort, inspect — no job mutations
- **Embedded**: Ships as a single `fetch` handler users mount on their existing server
- **All adapters**: Works with PostgreSQL, SQLite, and in-memory state adapters
- **Per-type detail hooks**: Users can attach async functions that return additional JSON context for specific job types, similar to how processors are keyed by type name
- **Polling**: No notify adapter integration — users refresh the page for updated data

## Package

Single package: `@queuert/dashboard`

- **Backend**: Hono (standard `fetch` handler)
- **Frontend**: SolidJS (pre-built JS/CSS shipped in package, served by Hono)
- **No auth**: Authentication/authorization is the user's responsibility (middleware before the dashboard handler)

## Configuration API

```typescript
import { createDashboard } from "@queuert/dashboard";

const dashboard = createDashboard({
  stateAdapter,

  // Optional: per-type hooks returning JSON for job detail views
  jobDetail: {
    "send-email": async ({ job }) => ({
      recipient: job.input.to,
      provider: "mailgun",
      deliveryStatus: await mailgun.getStatus(job.output?.messageId),
    }),
    "process-payment": async ({ job }) => ({
      amount: job.input.amount,
      gateway: "stripe",
    }),
  },
});

// Mount on any server that supports the fetch API
// Hono
app.route("/dashboard", dashboard);
// Express (with adapter), Fastify, Bun, Deno, etc.
```

`createDashboard` returns a Hono app instance. Users mount it at their chosen path. The app serves both API routes and the pre-built SolidJS frontend.

### Job Detail Hooks

Hooks are keyed by job type name, matching the pattern used by worker processors. Each hook receives the `StateJob` and returns a JSON-serializable value displayed in the job detail view.

```typescript
jobDetail: {
  [typeName: string]: (params: { job: StateJob }) => Promise<unknown> | unknown;
}
```

Hooks are called on-demand when a user views a job's detail. Errors in hooks are caught and displayed as error state in the UI (not propagated to the caller).

## State Adapter Extensions

The existing `StateAdapter` has point-query methods only. The dashboard needs list/filter/aggregate capabilities.

### New Methods

```typescript
// Pagination
type PageParams = {
  cursor?: string;
  limit: number;
};

type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

// Filtering and sorting
type ChainListParams = {
  txContext?: TTxContext;
  filter?: {
    status?: ("blocked" | "pending" | "running" | "completed")[];
    typeName?: string[];
  };
  sort?: {
    field: "createdAt" | "completedAt";
    direction: "asc" | "desc";
  };
  page: PageParams;
};

type JobListParams = {
  txContext?: TTxContext;
  filter?: {
    status?: ("blocked" | "pending" | "running" | "completed")[];
    typeName?: string[];
    chainId?: string;
  };
  sort?: {
    field: "createdAt" | "completedAt";
    direction: "asc" | "desc";
  };
  page: PageParams;
};
```

New methods on `StateAdapter`:

- **`listChains`** — List chains with pagination, filtering by status/type, sorting by createdAt/completedAt. Returns chains as `[rootJob, lastJob]` pairs (same shape as `getJobChainById`). The root job represents the chain identity; the last job shows current chain state.

- **`listJobs`** — List jobs with pagination, filtering by status/type/chainId, sorting by createdAt/completedAt. Returns `StateJob` items. When `chainId` is provided, returns all jobs in that chain (ordered by creation). Without `chainId`, returns jobs across all chains.

- **`getJobsBlockedByChain`** — Get jobs that depend on a given chain as a blocker. Returns jobs whose `blockedByChainIds` include this chain. Supports the "blocking" section in chain detail.

### Pagination

Cursor-based pagination. The cursor is opaque to callers — adapter implementations encode position information (e.g., ID + sort field value) into the cursor string. This avoids OFFSET-based pagination performance issues.

### Placement

These methods are added directly to the `StateAdapter` interface. They follow the same patterns as existing methods:
- Optional `txContext` parameter
- O(1) database round-trips (single query per call)
- Return plain `StateJob` types

The methods are optional on the interface (using `?:`) so existing adapter implementations continue to compile. The dashboard validates at startup that the required methods are present.

## API Routes

The Hono app serves:

### Static Assets

- `GET /` — SolidJS app (index.html)
- `GET /assets/*` — Pre-built JS/CSS bundles

### JSON API

All list endpoints return `Page<T>` responses with `items` and `nextCursor`.

**Chains**

- `GET /api/chains` — List chains. Query params: `status`, `typeName`, `sort`, `direction`, `cursor`, `limit`
- `GET /api/chains/:chainId` — Chain detail: root job, last job, all jobs in chain
- `GET /api/chains/:chainId/blocking` — Jobs that depend on this chain as a blocker

**Jobs**

- `GET /api/jobs` — List jobs across all chains. Query params: same as chains + `chainId`
- `GET /api/jobs/:jobId` — Job detail: job + blockers
- `GET /api/jobs/:jobId/detail` — Job detail hook result (calls user-provided hook for the job's type)

## UI Views

### Chain List

The primary view. A list of chains with inline previews showing the most important info at a glance.

- **Filtering**: By status (multi-select), by type name
- **Sorting**: By created at, completed at (asc/desc)
- **Pagination**: Cursor-based, load more

```
┌─────────────────────────────────────────────────────────────────────┐
│  Chains                                                             │
│                                                                     │
│  Status: [● All ▾]    Type: [All types ▾]    Sort: [Created ▾] [↓] │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                     │
│  ● send-welcome-email                              2m ago           │
│  ✓ completed                                                        │
│  { to: "alice@example.com" }              completed 1m ago          │
│                                                                     │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                     │
│  ● process-order                                   5m ago           │
│  ▸ running  (2/4 jobs)                                              │
│  { orderId: "ord_123" }                   attempt #1 in progress    │
│                                                                     │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                     │
│  ● generate-report                                 8m ago           │
│  ✗ running  (attempt #3)                                            │
│  { reportId: "rpt_456" }     error: "Connection timeout" at 6m ago  │
│                                                                     │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                     │
│  ● sync-inventory                                 12m ago           │
│  ◆ blocked  (waiting on 2 blockers)                                 │
│  { warehouseId: "wh_01" }                 scheduled 10m ago         │
│                                                                     │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                     │
│  [Load more]                                                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

Each row shows: chain type name, status badge, creation time, input summary, and the current state (last job status, error preview, blocker count). Clicking a row navigates to the chain detail view.

### Chain Detail

Shows a specific chain with its full job sequence and blocker relationships.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back                                                             │
│                                                                     │
│  process-order                                     chain ab12ef     │
│  ▸ running                                         created 5m ago   │
│                                                                     │
│  ── Jobs ───────────────────────────────────────────────────────── ─ │
│                                                                     │
│  1. validate-order                                                  │
│     ✓ completed    attempt #1    1m                 created 5m ago   │
│     input:  { orderId: "ord_123" }                                  │
│     output: { valid: true, items: 3 }                               │
│                                                                     │
│  2. charge-payment                                                  │
│     ▸ running      attempt #1    worker-2           created 4m ago   │
│     input:  { amount: 59.99, currency: "USD" }                      │
│     leased by worker-2 until 2m from now                            │
│     ┌ blockers ─────────────────────────────────┐                   │
│     │  ✓ verify-identity (chain c34f)  completed │                  │
│     │  ▸ fraud-check     (chain d56a)  running   │                  │
│     └────────────────────────────────────────────┘                  │
│                                                                     │
│  3. send-confirmation  ○ pending                                    │
│                                                                     │
│  4. update-inventory   ○ pending                                    │
│                                                                     │
│  ── Blocking ───────────────────────────────────────────────────── ─ │
│                                                                     │
│  Jobs depending on this chain as a blocker:                         │
│     ◆ sync-inventory (chain e78b) → job sync-inventory  blocked     │
│     ◆ notify-warehouse (chain f90c) → job notify-warehouse  blocked │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

- **Jobs section**: All jobs in the chain, ordered by creation. Completed jobs show input/output. Running jobs show lease info. Failed attempts show the error.
- **Blockers**: Shown per-job — only jobs that have blockers display the blockers subsection with chain links and status.
- **Blocking section**: Jobs from other chains that depend on this chain as a blocker.

### Job List

Cross-chain job view. Same layout as chain list, but each row is a job with a link to its parent chain.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Jobs                                                               │
│                                                                     │
│  Status: [● All ▾]    Type: [All types ▾]    Sort: [Created ▾] [↓] │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                     │
│  ● charge-payment                    chain: process-order (ab12ef)  │
│  ▸ running    attempt #1             worker-2              4m ago   │
│  { amount: 59.99, currency: "USD" }                                 │
│                                                                     │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                     │
│  ● send-welcome-email                chain: send-welcome-email (x)  │
│  ✓ completed  attempt #1                                   2m ago   │
│  { to: "alice@example.com" }                   completed 1m ago     │
│                                                                     │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                     │
│  ● generate-report                   chain: generate-report (y)     │
│  ✗ running    attempt #3             worker-1              8m ago   │
│  { reportId: "rpt_456" }          error: "Connection timeout"       │
│                                                                     │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│  [Load more]                                                        │
└─────────────────────────────────────────────────────────────────────┘
```

Each row shows: job type, status badge, attempt count, worker ID (if running), chain link, creation time, input summary, and error preview (if any). Clicking a row opens the job detail. The chain link navigates to the chain detail view.

### Job Detail

Full job inspection. Shown as a dedicated view when navigating from the job list, or inline-expanded in the chain detail view.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back                                                             │
│                                                                     │
│  charge-payment                                    job 7f8a2b       │
│  ▸ running                           chain: process-order (ab12ef)  │
│                                                                     │
│  ── Info ────────────────────────────────────────────────────────── │
│                                                                     │
│  Status       ▸ running                                             │
│  Attempt      #1                                                    │
│  Created      2024-01-15 14:30:02                                   │
│  Scheduled    2024-01-15 14:30:02                                   │
│  Leased by    worker-2                                              │
│  Leased until 2024-01-15 14:35:02                                   │
│                                                                     │
│  ── Input ───────────────────────────────────────────────────────── │
│                                                                     │
│  {                                                                  │
│    "amount": 59.99,                                                 │
│    "currency": "USD",                                               │
│    "customerId": "cus_abc123"                                       │
│  }                                                                  │
│                                                                     │
│  ── Blockers ────────────────────────────────────────────────────── │
│                                                                     │
│  ✓ verify-identity  (chain c34f)   completed                        │
│  ▸ fraud-check      (chain d56a)   running                          │
│                                                                     │
│  ── Detail (charge-payment hook) ────────────────────────────────── │
│                                                                     │
│  {                                                                  │
│    "gateway": "stripe",                                             │
│    "stripePaymentIntent": "pi_3abc",                                │
│    "gatewayStatus": "processing"                                    │
│  }                                                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

When a job is completed, the **Output** section appears. When a job has a `lastAttemptError`, the **Error** section appears with the error message. The **Detail** section only appears when a `jobDetail` hook is configured for the job's type.

## Build and Packaging

The `@queuert/dashboard` package contains:

```
packages/dashboard/
├── src/
│   ├── api/           # Hono routes
│   ├── frontend/      # SolidJS app source
│   └── index.ts       # createDashboard export
├── dist/
│   ├── api/           # Compiled Hono routes
│   ├── assets/        # Pre-built SolidJS JS/CSS
│   └── index.js       # Package entry point
└── package.json
```

The SolidJS frontend is built at package build time. The built assets are included in the published package. At runtime, Hono serves these assets as static files — no build step required by users.

### Dependencies

- `hono` — HTTP framework (fetch-compatible)
- `solid-js` / related build tooling — dev dependency only (pre-built at publish time)
- `queuert` — peer dependency (for `StateAdapter` types)

## Summary

The dashboard provides:

1. **Embeddable observation UI** — single `fetch` handler, mount anywhere
2. **Read-only** — list, filter, sort, inspect chains and jobs
3. **Per-type detail hooks** — user-defined async JSON context for job inspection
4. **Adapter-agnostic** — works with all state adapters via new list/filter methods
5. **Self-contained** — pre-built frontend, no external build steps
6. **Opt-in** — separate package, no impact on existing code unless adopted

See also:

- [Adapters](adapters.md) — Adapter design philosophy and StateAdapter interface
- [Observability Adapter](observability-adapter.md) — Complementary push-based observability
- [Job Chain Model](job-chain-model.md) — Chain/job unified model
