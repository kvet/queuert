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
});
// Returns:
// {
//   fetch: (request: Request, options?: { nonce?: string }) =>
//     Response | Promise<Response>
// }
```

The `fetch` handler serves both API routes and the pre-built SolidJS frontend. Mount it on any server runtime that accepts a standard `fetch` handler (Node.js, Bun, Deno).

The state adapter must implement dashboard listing methods (`listJobChains`, `listJobs`, `listBlockedJobs`). PostgreSQL, SQLite, and in-memory adapters all support these.

### options.nonce

An optional CSP nonce to inject into `<script>`, `<link>`, and `<style>` tags in the dashboard HTML. Pass this when your app sets a `Content-Security-Policy` header with `script-src 'nonce-...'` or `style-src 'nonce-...'`.

```typescript
const response = await dashboard.fetch(request, { nonce: cspNonce });
```

## See Also

- [Dashboard](/queuert/integrations/dashboard/) — Integration guide for the dashboard
