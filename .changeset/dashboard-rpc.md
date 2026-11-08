---
"@queuert/dashboard": major
---

The dashboard frontend now talks to its server through a single `POST {basePath}/api/rpc` endpoint, replacing the per-resource `/api/chains`, `/api/jobs` and `/api/workers` routes. The `createDashboard` options and `{ fetch }` handler are unchanged; only middleware or proxy rules that match the old API paths or methods need updating.

- The endpoint accepts only `POST` with `Content-Type: application/json`; other methods get a `405` and other content types a `415`.
- Responses stream as NDJSON, so an action such as deleting a chain is acknowledged immediately and its outcome arrives on the same response once the transaction commits.
- Reads and writes share the one endpoint and method, so a proxy rule can no longer tell them apart by HTTP method; gate `/api/rpc` as a whole.
- Responses decode without `eval`, so the dashboard works under a Content Security Policy without `unsafe-eval`.
