import { type BaseNavigationMap, type Client, type StateAdapter, helpersSymbol } from "queuert";
import { renderHtml } from "./html.js";
import { handleChainBlocking, handleChainDetail, handleChainsList } from "./routes/chains.js";
import { handleJobDetail, handleJobsList } from "./routes/jobs.js";

type Assets = Record<string, { content: string; contentType: string }>;

let cachedAssets: Assets | null | undefined;

const loadAssets = async (): Promise<Assets | null> => {
  if (cachedAssets !== undefined) return cachedAssets;
  try {
    const mod = await import("./routes/assets.generated.js");
    cachedAssets = mod.assets;
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
 * @experimental
 */
export const createDashboard = <
  TNavigationMap extends BaseNavigationMap,
  TStateAdapter extends StateAdapter<any, any>,
>(options: {
  client: Client<TNavigationMap, TStateAdapter>;
  /** Mount prefix without trailing slash (e.g. `'/internal/queuert'`). Defaults to `''` (root). */
  basePath?: string;
}): { fetch: (request: Request) => Response | Promise<Response> } => {
  const { stateAdapter } = options.client[helpersSymbol];
  const basePath = options.basePath?.replace(/\/+$/, "") ?? "";

  const handleRequest = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const { pathname } = url;

    // Strip basePath prefix to get the local route path
    if (basePath && !pathname.startsWith(basePath + "/") && pathname !== basePath) {
      return new Response("Not Found", { status: 404 });
    }
    const localPath = basePath ? pathname.slice(basePath.length) || "/" : pathname;
    let match: RegExpMatchArray | null;

    // API routes
    match = localPath.match(/^\/api\/chains\/([^/]+)\/blocking$/);
    if (match) return handleChainBlocking(url, stateAdapter, match[1]);

    match = localPath.match(/^\/api\/chains\/([^/]+)$/);
    if (match) return handleChainDetail(url, stateAdapter, match[1]);

    if (localPath === "/api/chains") return handleChainsList(url, stateAdapter);

    match = localPath.match(/^\/api\/jobs\/([^/]+)$/);
    if (match) return handleJobDetail(url, stateAdapter, match[1]);

    if (localPath === "/api/jobs") return handleJobsList(url, stateAdapter);

    // Static assets + SPA fallback
    const assets = await loadAssets();
    if (!assets)
      return new Response("Dashboard assets not built. Run `pnpm build` first.", { status: 503 });

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

    // SPA fallback — serve index.html with <base> tag for correct relative URLs
    const html = assets["/index.html"];
    if (!html) return new Response("Not Found", { status: 404 });
    return new Response(renderHtml(html.content, basePath), {
      headers: { "Content-Type": "text/html" },
    });
  };

  return { fetch: handleRequest };
};
