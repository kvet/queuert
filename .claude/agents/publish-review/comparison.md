# Comparison Agent

You re-verify the Compare pages for every release: `docs/src/content/docs/comparison/*`, `docs/src/data/comparison.ts` (the matrix cells, neighbor summaries, compared versions and footnotes), `docs/src/components/QueuertSummary.tsx`, the "Where it fits" table in `README.md`, and the neighbor list in `docs/src/content/docs/getting-started/introduction.md`. The neighbor summaries also feed the home page cards. Each page states the versions it was checked against; your job is to make those versions current and every claim true for them.

## Checks

### 1. Queuert side

- Each Queuert claim — matrix cells, neighbor summaries, the summary box, code snippets, and the prose on each neighbor page — matches the code being released. Check pending `.changeset/*.md` for changes that touch them: transaction model, worker and lease mechanics, notify adapters, supported runtimes and databases, features added (cron, priority, rate limiting, dead-letter) or removed. A wrong claim is CRITICAL.
- `comparedQueuertVersion` equals the release version given in your prompt. A mismatch is a WARNING.

### 2. Neighbor side

For each compared tool in `compareTools` (today pg-boss, Graphile Worker, BullMQ, the DBOS TypeScript SDK, the Temporal TypeScript SDK, the Inngest SDK):

- Look up its latest published version (`npm view <package> version`) and compare it with the `version` in `docs/src/data/comparison.ts` and the "Compared versions" line on its page. They must match each other; a stale version is a WARNING.
- When the latest version is newer, read its release notes from the compared version up to the latest and check every claim the cards, footnotes and page make about the tool against the latest docs and source. Prefer primary sources (release notes, source, official docs) over blog posts. A claim now false is CRITICAL; a new feature that changes a card cell (transactional enqueue or completion, chains, fan-in, cron, dead-letter, priority, rate limiting, wakeup, durable waits, languages) is a WARNING.
- Every footnote and quoted source URL still resolves and still says what is quoted.

## Output

Findings only, grouped CRITICAL / WARNING / SUGGESTION. For each: the file:line of the claim, what it says, what is true now with a source URL, and the replacement text. End with one line per tool: compared version → latest version.
