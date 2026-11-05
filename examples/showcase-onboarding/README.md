# Onboarding Showcase

The three-step chain shown on the docs home page — `provision-account` → `send-welcome-email` → `sync-to-crm` — runnable end to end on PostgreSQL with Drizzle.

The home page's code tour embeds the `define`, `create-chain` and `process` regions of `src/index.ts`, so the code there is the code that runs here.

## Running

```bash
pnpm install
pnpm --filter example-showcase-onboarding start
```
