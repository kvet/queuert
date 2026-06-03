---
"@queuert/dashboard": minor
---

The chain and job detail views' back link now returns you to where you actually came from instead of always jumping to the top of a fixed list. A plain click pops browser history — restoring the previous view and its filters (which live in the URL) — and it falls back to the relevant list when there is no in-app history to return to (a deep link, reload, or a card opened in a new tab). The label is now a generic "← Back" since the destination is no longer a fixed list.
