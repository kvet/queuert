# Dashboard Design

## Overview

The `@queuert/dashboard` package provides an embeddable web dashboard for observing job chains and jobs. It is a read-only observation platform — no mutations (retry, cancel, delete). Users can list, filter, inspect chain/job details, and view blocker relationships.

The dashboard complements `@queuert/otel` (push-based metrics/traces to external backends) with a focused, embedded UI that queries the job state directly. Like OTEL, the dashboard is opt-in.

## Goals

- **Observation only**: List, filter, inspect — no job mutations
- **Embedded**: Ships as a single `fetch` handler users mount on their existing server
- **All adapters**: Works with PostgreSQL, SQLite, and in-memory state adapters
- **Polling**: No notify adapter integration — users refresh the page for updated data

## Package

Single package: `@queuert/dashboard`

- **Backend**: Standard `fetch` handler (Hono bundled internally)
- **Frontend**: SolidJS (pre-built JS/CSS shipped in package)
- **No auth**: Authentication/authorization is the user's responsibility (middleware before the dashboard handler)

## Configuration API

```typescript
import { createDashboard } from "@queuert/dashboard";

const dashboard = createDashboard({
  client,
});

// Use with any server that accepts a fetch handler
serve({ fetch: dashboard.fetch, port: 3000 });
```

`createDashboard` accepts a Queuert `client` (created via `createClient`) and returns `{ fetch }` — a standard web `fetch` handler. Users pass it to any server runtime (Node.js, Bun, Deno, etc.). The handler serves both API routes and the pre-built SolidJS frontend. The dashboard extracts the state adapter from the client internally.

## UI Views

### Chain List

The primary view. A list of chains with inline previews showing the most important info at a glance.

- **Filtering**: By chain/job ID, by type name
- **Ordering**: Always by created_at DESC (newest first)
- **Pagination**: Cursor-based, load more

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Chain or job ID: [___________]   Type name: [___________]                   │
│                                                         [✓] Hide blockers    │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                              │
│  send-welcome-email ⊕  f1234567-…-345678901234 ⊕              2m ago         │
│  ✓ completed                                                                 │
│  { "to": "alice@example.com", "subject": "Welcome!" }                       │
│                                                                              │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                              │
│  process-order ⊕  ab12ef34-…-b56789012345 ⊕                   5m ago        │
│  ▸ running   order:charge (last)                                             │
│  { "orderId": "ORD-001", "items": 3 }                                       │
│                                                                              │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                              │
│  flaky-import ⊕  f8901234-…-d34567890123 ⊕                    8m ago        │
│  ▸ running                                                                   │
│  { "fileUrl": "https://data.example.com/export.csv" }                        │
│                                                                              │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                              │
│  create-listing ⊕  e78b1234-…-d34567890123 ⊕                 12m ago        │
│  ◆ blocked   attempt #2                                                      │
│  { "productId": "prod-001" }                                                 │
│                                                                              │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                              │
│  [Load more]                                                                 │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

`⊕` is the filter button — clicking it sets the corresponding filter (type name or chain ID). The "Chain or job ID" field searches by chain ID directly, or finds the chain containing a job with that ID. Each row shows: chain type name (with filter button), chain ID (with filter button), status badge, last job type (if continuation), attempt count (blocked only), creation time, and input preview. Clicking a row navigates to the chain detail view.

### Chain Detail

Shows a specific chain with its full job sequence and blocker relationships.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ← Back to chains                                                            │
│                                                                              │
│  process-order  ▸ running                                                    │
│  chain ab12ef34-5678-4901-a234-b56789012345                                  │
│  Created 5m ago                                                              │
│                                                                              │
│  ── Jobs (4) ────────────────────────────────────────────────────────────── │
│                                                                              │
│  ┌ 1. order:validate                                                       ┐ │
│  │  ✓ completed   attempt #1                                    5m ago     │ │
│  │  ── Input ──                                                            │ │
│  │  { "orderId": "ORD-001", "items": 3 }                                  │ │
│  │  ── Output ──                                                           │ │
│  │  { "orderId": "ORD-001", "valid": true }                               │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌ 2. order:charge                                                         ┐ │
│  │  ▸ running   attempt #1   worker-2                           4m ago     │ │
│  │  ── Input ──                                                            │ │
│  │  { "orderId": "ORD-001", "amount": 89.97 }                             │ │
│  │  Blockers                                                               │ │
│  │  ✓ verify-identity  [chain c34f5678-9a01-4b23-c456-d78901234567]        │ │
│  │  ▸ fraud-check      [chain d56a7890-1b23-4c45-d678-e90123456789]        │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌ 3. order:ship                                                           ┐ │
│  │  ○ pending                                                   3m ago     │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌ 4. order:confirm                                                        ┐ │
│  │  ○ pending                                                   3m ago     │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ── Blocking ────────────────────────────────────────────────────────────── │
│                                                                              │
│  Jobs depending on this chain as a blocker:                                  │
│  ◆ sync-inventory      [chain e78b1234-5a67-4b89-c012-d34567890123]         │
│  ◆ notify-warehouse    [chain f90c2345-6b78-4c90-d123-e45678901234]         │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Jobs section**: All jobs in the chain, ordered by creation. Each job is a clickable card. Completed jobs show input/output. Running jobs show lease info and worker. Failed attempts show the error.
- **Blockers**: Shown per-job — only jobs that have blockers display the blockers subsection with chain links and status.
- **Blocking section**: Jobs from other chains that depend on this chain as a blocker.

### Job List

Cross-chain job view. Same layout as chain list, but each row is a job with a link to its parent chain.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Job or chain ID: [___________]   Type name: [___________]                   │
│  Status: [All statuses ▾]                                                    │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                              │
│  order:charge ⊕  a1b2c3d4-…-e56789012345 ⊕                    4m ago        │
│  ▸ running   worker-2                                                        │
│  [chain ab12ef34-5678-4901-a234-b56789012345]                                │
│  { "orderId": "ORD-001", "amount": 89.97 }                                  │
│                                                                              │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                              │
│  send-welcome-email ⊕  b2c3d4e5-…-f67890123456 ⊕              2m ago        │
│  ✓ completed                                                                 │
│  [chain f1234567-89ab-4cde-f012-345678901234]                                │
│  { "to": "alice@example.com", "subject": "Welcome!" }                       │
│                                                                              │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                              │
│  flaky-import ⊕  c3d4e5f6-…-a78901234567 ⊕                    8m ago        │
│  ▸ running   worker-1                                                        │
│  [chain f8901234-5a67-4b89-c012-d34567890123]                                │
│  { "fileUrl": "https://data.example.com/export.csv" }                        │
│                                                                              │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                              │
│  [Load more]                                                                 │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

Each row shows: job type (with filter button), job ID (with filter button), status badge, attempt count (blocked only), worker ID (if running), chain link (full ID), creation time, and input preview. The "Job or chain ID" field matches job ID directly or chain ID. The `⊕` filter button on the job ID sets the ID filter. Clicking a row opens the job detail. The chain link navigates to the chain detail view.

### Job Detail

Full job inspection. Shown as a dedicated view when navigating from the job list, or inline-expanded in the chain detail view. Sections appear conditionally based on job state.

#### Blocked

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ← Back to jobs                                                              │
│                                                                              │
│  create-listing  ◆ blocked                                                   │
│  job a12b3456-7c89-4def-a012-bcdef3456789                                    │
│  chain: [create-listing (e78b90ab-1c23-4d56-e789-f01234567890)]              │
│                                                                              │
│  ── Info ─────────────────────────────────────────────────────────────────── │
│                                                                              │
│  Status        ◆ blocked                                                     │
│  Attempt       #0                                                            │
│  Created       Jan 15, 2024, 2:25:00 PM (10m ago)                           │
│  Scheduled     Jan 15, 2024, 2:25:00 PM (10m ago)                           │
│                                                                              │
│  ── Blockers ─────────────────────────────────────────────────────────────── │
│                                                                              │
│  ✓ fetch-inventory  [chain c34f5678-9a01-4b23-c456-d78901234567]             │
│  ▸ fetch-pricing    [chain d56a7890-1b23-4c45-d678-e90123456789]             │
│                                                                              │
│  ── Input ────────────────────────────────────────────────────────────────── │
│                                                                              │
│  {                                                                           │
│    "productId": "prod-001"                                                   │
│  }                                                                           │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### Running

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ← Back to jobs                                                              │
│                                                                              │
│  flaky-import  ▸ running                                                     │
│  job e45f6789-0a12-4b34-c567-d89012345678                                    │
│  chain: [flaky-import (f8901234-5a67-4b89-c012-d34567890123)]                │
│                                                                              │
│  ── Info ─────────────────────────────────────────────────────────────────── │
│                                                                              │
│  Status        ▸ running                                                     │
│  Attempt       #3                                                            │
│  Created       Jan 15, 2024, 2:25:00 PM (10m ago)                           │
│  Scheduled     Jan 15, 2024, 2:34:30 PM (30s ago)                           │
│  Leased by     worker-1                                                      │
│  Lease until   Jan 15, 2024, 2:39:30 PM (in 4m)                             │
│                                                                              │
│  ── Input ────────────────────────────────────────────────────────────────── │
│                                                                              │
│  {                                                                           │
│    "fileUrl": "https://data.example.com/export.csv"                          │
│  }                                                                           │
│                                                                              │
│  ── Error ────────────────────────────────────────────────────────────────── │
│                                                                              │
│  Connection reset (attempt 2)                                                │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### Completed (with output)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ← Back to jobs                                                              │
│                                                                              │
│  charge-payment  ✓ completed                                                 │
│  job 7f8a2b34-5c67-4d89-e012-f34567890123                                    │
│  chain: [process-order (ab12ef34-5678-4901-a234-b56789012345)]               │
│                                                                              │
│  ── Info ─────────────────────────────────────────────────────────────────── │
│                                                                              │
│  Status        ✓ completed                                                   │
│  Attempt       #1                                                            │
│  Created       Jan 15, 2024, 2:30:02 PM (5m ago)                            │
│  Scheduled     Jan 15, 2024, 2:30:02 PM (5m ago)                            │
│  Completed     Jan 15, 2024, 2:34:00 PM (1m ago)                            │
│  Completed by  worker-2                                                      │
│                                                                              │
│  ── Blockers ─────────────────────────────────────────────────────────────── │
│                                                                              │
│  ✓ verify-identity  [chain c34f5678-9a01-4b23-c456-d78901234567]             │
│  ✓ fraud-check      [chain d56a7890-1b23-4c45-d678-e90123456789]             │
│                                                                              │
│  ── Input ────────────────────────────────────────────────────────────────── │
│                                                                              │
│  {                                                                           │
│    "amount": 59.99,                                                          │
│    "currency": "USD",                                                        │
│    "customerId": "cus_abc123"                                                │
│  }                                                                           │
│                                                                              │
│  ── Output ───────────────────────────────────────────────────────────────── │
│                                                                              │
│  {                                                                           │
│    "chargeId": "ch_abc123",                                                  │
│    "orderId": "ord_456"                                                      │
│  }                                                                           │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### Completed (with continuation)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ← Back to jobs                                                              │
│                                                                              │
│  order:validate  ✓ completed                                                 │
│  job 3a9c1d23-4e56-4f78-9012-a34567890123                                    │
│  chain: [process-order (ab12ef34-5678-4901-a234-b56789012345)]               │
│                                                                              │
│  ── Info ─────────────────────────────────────────────────────────────────── │
│                                                                              │
│  Status        ✓ completed                                                   │
│  Attempt       #1                                                            │
│  Created       Jan 15, 2024, 2:28:00 PM (7m ago)                            │
│  Scheduled     Jan 15, 2024, 2:28:00 PM (7m ago)                            │
│  Completed     Jan 15, 2024, 2:29:00 PM (6m ago)                            │
│  Completed by  worker-1                                                      │
│                                                                              │
│  ── Input ────────────────────────────────────────────────────────────────── │
│                                                                              │
│  {                                                                           │
│    "orderId": "ORD-001",                                                     │
│    "items": 3                                                                │
│  }                                                                           │
│                                                                              │
│  ── Continued with ──────────────────────────────────────────────────────── │
│                                                                              │
│  [order:charge  ✓ completed]                                                 │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

`[text]` denotes a clickable link. Links navigate to the corresponding chain or job detail view.

Conditional sections:

- **Blockers** — only when the job has blockers.
- **Input** — when the job has input data.
- **Output** or **Continued with** (mutually exclusive) — Output shows the result JSON for terminal jobs. Continued with shows a link to the next job with its status.
- **Error** — when the job has a `lastAttemptError`.

## Summary

The dashboard provides:

1. **Embeddable observation UI** — single `fetch` handler, mount anywhere
2. **Read-only** — list, filter, inspect chains and jobs
3. **Adapter-agnostic** — works with all state adapters via new list/filter methods
4. **Self-contained** — pre-built frontend, no external build steps
5. **Opt-in** — separate package, no impact on existing code unless adopted

See also:

- [Adapters](adapters.md) — Adapter design philosophy and StateAdapter interface
- [Observability Adapter](observability-adapter.md) — Complementary push-based observability
- [Job Chain Model](job-chain-model.md) — Chain/job unified model
