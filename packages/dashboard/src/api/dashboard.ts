import { Hono } from "hono";
import { type BaseJobTypeDefinitions, type Client, type StateAdapter } from "queuert";
import { clientInternals } from "queuert/internal";
import { createChainRoutes } from "./routes/chains.js";
import { createJobRoutes } from "./routes/jobs.js";

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

  const app = new Hono();

  app.route("/api/chains", createChainRoutes(stateAdapter));
  app.route("/api/jobs", createJobRoutes(stateAdapter));

  // Static assets + SPA fallback
  app.get("/*", async (c) => {
    const assets = await loadAssets();
    if (!assets) return c.text("Dashboard assets not built. Run `pnpm build` first.", 503);

    // Serve asset if path ends with /assets/... (works at any mount depth)
    const assetMatch = c.req.path.match(/\/(assets\/.+)$/);
    if (assetMatch) {
      const assetPath = "/" + assetMatch[1];
      const asset = assets[assetPath];
      if (asset) {
        const headers: Record<string, string> = { "Content-Type": asset.contentType };
        if (/\.[a-f0-9]{8,}\.\w+$/.test(assetPath)) {
          headers["Cache-Control"] = "public, max-age=31536000, immutable";
        }
        return c.body(asset.content, { headers });
      }
    }

    // SPA fallback — serve index.html with <base> tag for correct relative URLs
    const html = assets["/index.html"];
    if (!html) return c.notFound();
    const mountPath = c.req.path
      .replace(/\/(?:chains|jobs)\/.*$/, "/")
      .replace(/\/+$/, "/")
      .replace(/[^a-zA-Z0-9/_.-]/g, "");
    return c.html(html.content.replace("<head>", `<head><base href="${mountPath}" />`));
  });

  return { fetch: app.fetch };
};
