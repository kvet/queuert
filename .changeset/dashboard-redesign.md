---
"@queuert/dashboard": minor
---

Redesign the dashboard UI. Types and lists are redesigned: list rows show their input and output at a glance, a new Overview home page shows totals per status across all types, and IDs are looked up from anywhere with Find by ID (`⌘K`). The API now answers malformed IDs with "not found" instead of a server error.

- New Overview home page; `/` no longer redirects to the chain types.
- A terminal-like look: monospace text, near-square corners. Types use one compact row each, and chain and job list rows show status, ID and time with one-line input and output previews; detail pages are a single column; status filtering moves to status tabs, and the "All" tab replaces clicking the selected count chip again.
- Find by ID (`⌘K` / `Ctrl+K`) with a `/find` results page replaces the ID inputs and per-row "filter by ID" buttons; `/chains?ids=` and `/jobs?ids=` redirect to it.
- Jobs rescheduled after an error show their attempt count and last error; chain detail shows its jobs in sequence and folds runs of repeated completed jobs.
- A running chain's detail page names its current job and that job's status (the chain detail API returns it as `currentJob`); job rows link to their chain as "#N of chain-type · chain-id".
- "Run now" reports failures instead of failing silently.
- Blocked jobs on chain detail link to the job instead of its chain.
- Delete warns up front when the chain is still a blocker, and returns to that type's list.
- New Queuert logo in the top bar, also used as the browser tab icon.
- Theme switch (System / Light / Dark), manual refresh with optional auto-refresh (off by default), and relative times that update live.
- Malformed IDs return 404 from detail and action endpoints and are omitted from by-ids results; by-ids rejects more than 100 IDs with a 400; uncaught API errors return a 500 with an `{ error }` body like other API errors, instead of propagating to the host server (so host error middleware no longer sees them), and unknown `/api` paths or methods return a 404 instead of the dashboard page or a read.
