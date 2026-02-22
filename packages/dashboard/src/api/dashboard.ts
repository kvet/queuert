import { type BaseJobTypeDefinitions, type Client, type StateAdapter } from "queuert";
import { clientInternals } from "queuert/internal";
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

export const createDashboard = <
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
>(options: {
  client: Client<TJobTypeDefinitions, TStateAdapter>;
}): { fetch: (request: Request) => Response | Promise<Response> } => {
  const stateAdapter = options.client[clientInternals].stateAdapter;

  const handleRequest = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const { pathname } = url;
    let match: RegExpMatchArray | null;

    // API routes
    match = pathname.match(/^\/api\/chains\/([^/]+)\/blocking$/);
    if (match) return handleChainBlocking(url, stateAdapter, match[1]);

    match = pathname.match(/^\/api\/chains\/([^/]+)$/);
    if (match) return handleChainDetail(url, stateAdapter, match[1]);

    if (pathname === "/api/chains") return handleChainsList(url, stateAdapter);

    match = pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (match) return handleJobDetail(url, stateAdapter, match[1]);

    if (pathname === "/api/jobs") return handleJobsList(url, stateAdapter);

    // Static assets + SPA fallback
    const assets = await loadAssets();
    if (!assets)
      return new Response("Dashboard assets not built. Run `pnpm build` first.", { status: 503 });

    const assetMatch = pathname.match(/\/(assets\/.+)$/);
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
    const mountPath = pathname
      .replace(/\/(?:chains|jobs)\/.*$/, "/")
      .replace(/\/+$/, "/")
      .replace(/[^a-zA-Z0-9/_.-]/g, "");
    return new Response(html.content.replace("<head>", `<head><base href="${mountPath}" />`), {
      headers: { "Content-Type": "text/html" },
    });
  };

  return { fetch: handleRequest };
};
