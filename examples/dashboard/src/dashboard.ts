/**
 * Dashboard Server
 *
 * Starts the @queuert/dashboard web UI on http://localhost:3333.
 * Reads job state from the shared SQLite database.
 *
 * Usage: pnpm dashboard
 * Then open http://localhost:3333 in your browser.
 */

import { createDashboard } from "@queuert/dashboard";
import { createServer } from "node:http";
import { client, db } from "./client.js";

const PORT = 3333;

const dashboard = createDashboard({ client });

const server = createServer((req, res) => {
  void Promise.resolve(
    dashboard.fetch(new Request(`http://localhost:${PORT}${req.url}`, { method: req.method })),
  ).then(async (response) => {
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  });
});

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  console.log("Run `pnpm start` in another terminal to populate jobs.\n");
});

process.on("SIGINT", () => {
  server.close();
  db.close();
  process.exit(0);
});
