/**
 * Dashboard Server
 *
 * Starts the @queuert/dashboard web UI on http://localhost:3333.
 * Reads job state from the shared SQLite database.
 *
 * Then open http://localhost:3333 in your browser.
 */

import { createServer } from "node:http";

import { createDashboard } from "@queuert/dashboard";

import { client, db, notifyAdapter, stateAdapter } from "./common.js";

const PORT = 3333;

// #region dashboard
const dashboard = await createDashboard({ client });
// #endregion

// #region server
const server = createServer((req, res) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
  }
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    void Promise.resolve(
      dashboard.fetch(
        new Request(`http://localhost:${PORT}${req.url}`, {
          method: req.method,
          headers,
          body: hasBody ? new Uint8Array(Buffer.concat(chunks)) : undefined,
        }),
      ),
    ).then(async (response) => {
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    });
  });
});

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  console.log("Run `pnpm start` in another terminal to populate jobs.\n");
});
// #endregion

process.on("SIGINT", () => {
  void (async () => {
    server.close();
    await notifyAdapter.close();
    await stateAdapter.close();
    db.close();
    process.exit(0);
  })();
});
