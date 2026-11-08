import "./dispose-symbols.ts";
import { createDashboard } from "@queuert/dashboard";

import { type DashboardDemoView, seedDashboardDemo } from "./seed.ts";

declare const self: ServiceWorkerGlobalScope;

const scope = new URL(self.registration.scope);
const basePath = scope.pathname.replace(/\/$/, "");
const viewPrefix = `${scope.pathname}__view/`;

let demo:
  | Promise<{
      fetch: (request: Request) => Response | Promise<Response>;
      paths: Record<DashboardDemoView, string>;
    }>
  | undefined;

const startDemo = async () => {
  const { client, paths } = await seedDashboardDemo();
  return { fetch: createDashboard({ client, basePath }).fetch, paths };
};

const respond = async (request: Request, url: URL): Promise<Response> => {
  demo ??= startDemo();
  const started = await demo;
  if (url.pathname.startsWith(viewPrefix)) {
    const path = new Map(Object.entries(started.paths)).get(url.pathname.slice(viewPrefix.length));
    return path === undefined
      ? new Response("Unknown dashboard demo view", { status: 404 })
      : Response.redirect(new URL(basePath + path, scope).href, 302);
  }
  return started.fetch(request);
};

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  event.respondWith(respond(event.request, url));
});
