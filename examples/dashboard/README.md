# Dashboard Example

`@queuert/dashboard` embedded as a `fetch` handler with Node's built-in HTTP server. Run the populator to generate chains, jobs and workers, browse them through the web UI.

## Running

```bash
pnpm install

# Terminal 1 — start the dashboard
pnpm --filter example-dashboard dashboard

# Terminal 2 — populate jobs (single jobs, continuations, blockers, retries, leftover workers)
pnpm --filter example-dashboard start
```

Open http://localhost:3333.

To serve the dashboard under a sub-path behind HTTP Basic authentication instead, run `DASHBOARD_PASSWORD=<password> pnpm --filter example-dashboard dashboard:mounted` and open http://localhost:3334/internal/queuert/ (user `admin`, password from `DASHBOARD_PASSWORD`; the server exits with an error when it is unset).
