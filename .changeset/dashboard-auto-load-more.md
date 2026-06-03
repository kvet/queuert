---
"@queuert/dashboard": minor
---

List views now load the next page automatically as you scroll instead of requiring a click. This applies to the chain list, the job list, and the job sequence within the chain detail view, with the "Load more" button retained as a manual fallback that shows a loading state while fetching. The chain and job list page size increased from 25 to 100, and the chain detail view now pages through its jobs (backed by a new `GET /api/chains/{chainId}/jobs` endpoint and a `nextCursor` on the chain detail response) rather than fetching up to 1000 at once. The chain detail "Blocking" list is likewise paged 100 at a time (`GET /api/chains/{chainId}/blocking` now accepts `cursor`/`limit` and returns a `nextCursor`) behind a manual "Load more" button.
