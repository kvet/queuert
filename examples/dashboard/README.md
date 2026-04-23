# Dashboard Example

`@queuert/dashboard` embedded as a `fetch` handler with Node's built-in HTTP server. Run the populator to generate chains/jobs, browse them through the web UI.

## Running

```bash
bun install

# Terminal 1 — start the dashboard
bun run --filter example-dashboard dashboard

# Terminal 2 — populate jobs (single jobs, continuations, blockers, retries)
bun run --filter example-dashboard start
```

Open http://localhost:3333.
