import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const isQueuertPackage = (specifier: string): boolean =>
  specifier === "queuert" || specifier.startsWith("queuert/") || specifier.startsWith("@queuert/");

const packageRootOf = (url: string): string => url.slice(0, url.lastIndexOf("/src/") + 1);

const distUrls = new Map<string, string>();

const distUrlFor = (sourceUrl: string): string => {
  const cached = distUrls.get(sourceUrl);
  if (cached !== undefined) return cached;
  const packageRoot = packageRootOf(sourceUrl);
  const packageJson = JSON.parse(
    readFileSync(fileURLToPath(new URL("package.json", packageRoot)), "utf8"),
  ) as {
    exports?: Record<string, string>;
    publishConfig?: { exports?: Record<string, string> };
  };
  const subpath = Object.entries(packageJson.exports ?? {}).find(
    ([, target]) => new URL(target, packageRoot).href === sourceUrl,
  )?.[0];
  const distTarget =
    subpath === undefined ? undefined : packageJson.publishConfig?.exports?.[subpath];
  if (distTarget === undefined) {
    throw new Error(`No publishConfig export for ${sourceUrl}`);
  }
  const distUrl = pathToFileURL(fileURLToPath(new URL(distTarget, packageRoot))).href;
  distUrls.set(sourceUrl, distUrl);
  return distUrl;
};

registerHooks({
  resolve: (specifier, context, nextResolve) => {
    const resolved = nextResolve(specifier, context);
    if (!isQueuertPackage(specifier) || !resolved.url.includes("/src/")) return resolved;
    return { ...resolved, url: distUrlFor(resolved.url), format: "module" };
  },
});
