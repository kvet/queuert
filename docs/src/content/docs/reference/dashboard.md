---
title: "@queuert/dashboard"
description: Web dashboard for monitoring Queuert.
sidebar:
  order: 10
---

:::caution
This package is experimental and may change without notice.
:::

## createDashboard

```typescript
const dashboard = await createDashboard({
  client: Client, // Queuert client from createClient()
  basePath?: string, // Mount prefix without trailing slash (e.g. '/internal/queuert')
});
// Returns:
// {
//   fetch: (request: Request) => Response | Promise<Response>
// }
```

The `fetch` handler serves both API routes and the pre-built SolidJS frontend. Mount it on any server runtime that accepts a standard `fetch` handler (Node.js, Bun, Deno).

The state adapter must implement dashboard listing methods (`listChains`, `listJobs`, `listBlockedJobs`). The PostgreSQL and SQLite adapters support these.

### options.basePath

Mount prefix for sub-path deployments. Set this when the dashboard is served behind a reverse proxy or framework router at a path other than `/`. The value should not include a trailing slash.

```typescript
const dashboard = await createDashboard({
  client,
  basePath: "/internal/queuert",
});
```

## Performance

Chain listing joins each root row with the last job in the chain. Filtering by `status` is not optimized — always pass `typeName` to narrow the scan. See [Performance considerations](/queuert/guides/queries/#performance-considerations).

## See Also

- [Dashboard](/queuert/integrations/dashboard/) — Integration guide for the dashboard
