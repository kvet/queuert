/**
 * Mounted Dashboard Server
 *
 * Serves @queuert/dashboard under http://localhost:3334/internal/queuert/ behind HTTP Basic
 * authentication (user `admin`, password from DASHBOARD_PASSWORD, which must be set).
 * Reads job state from the shared SQLite database.
 */

import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { createDashboard } from "@queuert/dashboard";

import { client, db, notifyAdapter, stateAdapter } from "./common.ts";

const PORT = 3334;

// #region base-path
const dashboard = createDashboard({
  client,
  basePath: "/internal/queuert",
});
// #endregion

// #region auth
const password = process.env.DASHBOARD_PASSWORD;
if (!password) {
  throw new Error("DASHBOARD_PASSWORD is not set: set it to the dashboard admin password");
}
const expectedAuthorization = Buffer.from(
  `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`,
);

const isAdmin = (request: Request): boolean => {
  const authorization = Buffer.from(request.headers.get("authorization") ?? "");
  return (
    authorization.length === expectedAuthorization.length &&
    timingSafeEqual(authorization, expectedAuthorization)
  );
};

const handler = async (request: Request): Promise<Response> => {
  if (!isAdmin(request)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="queuert"' },
    });
  }
  return dashboard.fetch(request);
};
// #endregion

const server = createServer((req, res) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
  }
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    void handler(
      new Request(`http://localhost:${PORT}${req.url}`, {
        method: req.method,
        headers,
        body: hasBody ? new Uint8Array(Buffer.concat(chunks)) : undefined,
      }),
    ).then(async (response) => {
      res.writeHead(response.status, Object.fromEntries(response.headers));
      for await (const chunk of response.body ?? []) res.write(chunk);
      res.end();
    });
  });
});

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}/internal/queuert/`);
  console.log("Run `pnpm start` in another terminal to populate jobs.\n");
});

process.on("SIGINT", () => {
  void (async () => {
    server.close();
    await notifyAdapter.close();
    await stateAdapter.close();
    db.close();
    process.exit(0);
  })();
});
