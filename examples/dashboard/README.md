# Dashboard Example

This example demonstrates how to use `@queuert/dashboard` to observe job chains and jobs through a web UI.

## What it shows

1. Embedding the dashboard as a `fetch` handler with Node's built-in HTTP server
2. Browsing chains and jobs with filtering, pagination, and status badges
3. Inspecting chain detail views with job sequences and blocker relationships
4. Viewing job details with input/output data, errors, and continuations

## Running the example

```bash
# Terminal 1: Start the dashboard server
pnpm --filter example-dashboard dashboard

# Terminal 2: Populate jobs
pnpm --filter example-dashboard start
```

Open http://localhost:3333 to view the dashboard.

## Demo scenarios

### 1. Single Job

```
greet → "Hello, World!"
```

One chain, one job. Shows the simplest chain card in the list view.

### 2. Continuations

```
order:validate → order:process → order:complete
```

Linear chain with 3 jobs linked via `continueWith`. Chain detail shows the full job sequence.

### 3. Blockers (fan-out/fan-in)

```
fetch-user ------+
                  +--> process-with-blockers
fetch-permissions-+
```

Main job waits for 2 parallel blocker chains. Chain detail shows blocker relationships with status.

### 4. Retries

```
might-fail (attempt #1: fail) → (attempt #2: success)
```

Job fails on first attempt, then succeeds. Job detail shows the error from the failed attempt.

## Scripts

| Script      | Description                         |
| ----------- | ----------------------------------- |
| `dashboard` | Start the dashboard web UI          |
| `start`     | Populate jobs (run all 4 scenarios) |

## Key files

- `src/client.ts` - Shared client setup (registry, state adapter, client)
- `src/dashboard.ts` - Dashboard server
- `src/start.ts` - Job populator with processors and scenarios
- `src/db.ts` - SQLite database setup
