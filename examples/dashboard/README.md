# Dashboard Example

`@queuert/dashboard` embedded as a `fetch` handler with Node's built-in HTTP server. Run the populator to generate chains/jobs, browse them through the web UI.

## Running

```bash
pnpm install

# Terminal 1 — start the dashboard
pnpm --filter example-dashboard dashboard

# Terminal 2 — populate jobs (single jobs, continuations, blockers, retries, leftover workers)
pnpm --filter example-dashboard start
```

Open http://localhost:3333.
