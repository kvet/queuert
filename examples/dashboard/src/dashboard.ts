/**
 * Dashboard Server
 *
 * Starts the @queuert/dashboard web UI on http://localhost:3333.
 * Reads job state from the shared SQLite database.
 *
 * Usage: pnpm dashboard
 * Then open http://localhost:3333 in your browser.
 */

import { serve } from "@hono/node-server";
import { createDashboard } from "@queuert/dashboard";
import { client, db } from "./client.js";

const PORT = 3333;

const dashboard = createDashboard({ client });

console.log(`Dashboard running at http://localhost:${PORT}`);
console.log("Run `pnpm start` in another terminal to populate jobs.\n");

const server = serve({ fetch: dashboard.fetch, port: PORT });

process.on("SIGINT", () => {
  server.close();
  db.close();
  process.exit(0);
});
