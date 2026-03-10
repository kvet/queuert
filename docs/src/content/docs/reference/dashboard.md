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
const dashboard = createDashboard({
  client: Client, // Queuert client from createClient()
  basePath?: string, // Mount prefix without trailing slash (e.g. '/internal/queuert')
});
// Returns:
// {
//   fetch: (request: Request) => Response | Promise<Response>
// }
```

The `fetch` handler serves both API routes and the pre-built SolidJS frontend. Mount it on any server runtime that accepts a standard `fetch` handler (Node.js, Bun, Deno).

The state adapter must implement dashboard listing methods (`listJobChains`, `listJobs`, `listBlockedJobs`). The PostgreSQL and SQLite adapters support these.

### options.basePath

Mount prefix for sub-path deployments. Set this when the dashboard is served behind a reverse proxy or framework router at a path other than `/`. The value should not include a trailing slash.

```typescript
const dashboard = createDashboard({
  client,
  basePath: "/internal/queuert",
});
```

## See Also

- [Dashboard](/queuert/integrations/dashboard/) — Integration guide for the dashboard
