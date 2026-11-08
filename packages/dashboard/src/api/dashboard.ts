import { errorResponse, handleRpc } from "@queuert/rpc/server";
import type { BaseJobTypeDefinitions, Client, StateAdapter } from "queuert";

import { renderHtml } from "./html.ts";
import { serverFns } from "./serverFns.ts";

type Assets = Record<string, { content: string; contentType: string }>;

let cachedAssets: Assets | null | undefined;

const loadAssets = async (): Promise<Assets | null> => {
  if (cachedAssets !== undefined) return cachedAssets;
  try {
    const assetsModule = await import("./assets.generated.ts");
    cachedAssets = assetsModule.assets;
  } catch {
    cachedAssets = null;
  }
  return cachedAssets;
};

/**
 * Create an embeddable dashboard request handler. Returns a `{ fetch }` object compatible with standard `Request`/`Response`.
 *
 * When mounting the dashboard at a sub-path (e.g. behind a reverse proxy or framework router),
 * set `basePath` to the mount prefix so that routing and asset loading work correctly.
 *
 * @example
 * ```ts
 * const dashboard = createDashboard({ client, basePath: '/internal/queuert' });
 * ```
 *
 * @param options - Dashboard configuration.
 * @experimental
 */
export const createDashboard = <
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any, any>,
>(options: {
  /** The Queuert client the dashboard reads jobs, chains and workers from. */
  client: Client<TJobTypeDefinitions, TStateAdapter>;
  /** Mount prefix without trailing slash (e.g. `'/internal/queuert'`). Defaults to `''` (root). */
  basePath?: string;
}): { fetch: (request: Request) => Response | Promise<Response> } => {
  const client = options.client as unknown as Client<any, any>;
  const basePath = options.basePath?.replace(/\/+$/, "") ?? "";

  const handleRequest = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const { pathname } = url;

    if (basePath && !pathname.startsWith(basePath + "/") && pathname !== basePath) {
      return new Response("Not Found", { status: 404 });
    }
    const localPath = basePath ? pathname.slice(basePath.length) || "/" : pathname;
    if (localPath === "/api" || localPath.startsWith("/api/")) {
      if (localPath !== "/api/rpc") return errorResponse("Not found", 404);
      try {
        return await handleRpc(request, { client }, serverFns);
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err), 500);
      }
    }

    const assets = await loadAssets();
    if (!assets)
      return new Response("Dashboard assets not built. Run `pnpm build` first.", {
        status: 503,
      });

    const assetMatch = localPath.match(/^\/(assets\/.+)$/);
    if (assetMatch) {
      const assetPath = "/" + assetMatch[1];
      const asset = assets[assetPath];
      if (asset) {
        const headers: Record<string, string> = { "Content-Type": asset.contentType };
        if (/\.[a-f0-9]{8,}\.\w+$/.test(assetPath)) {
          headers["Cache-Control"] = "public, max-age=31536000, immutable";
        }
        return new Response(asset.content, { headers });
      }
    }

    const html = assets["/index.html"];
    if (!html) return new Response("Not Found", { status: 404 });
    return new Response(renderHtml(html.content, basePath), {
      headers: { "Content-Type": "text/html" },
    });
  };

  return { fetch: handleRequest };
};
