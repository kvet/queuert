import { faviconDataUri } from "@queuert/ui/logo";
import { describe, expect, it } from "vitest";

import { renderHtml } from "../api/html.ts";

const MOCK_HTML = [
  "<!DOCTYPE html><html>",
  '<head><link rel="stylesheet" href="assets/index-abc12345.css"></head>',
  '<body><script type="module" src="assets/index-abc12345.js"></script></body>',
  "</html>",
].join("");

describe("renderHtml", () => {
  it("injects base href for sub-path", () => {
    const result = renderHtml(MOCK_HTML, "/internal/queuert");
    expect(result).toContain('<base href="/internal/queuert/" />');
    expect(result).not.toContain("__QUEUERT_BASE__");
  });

  it("injects root base href when basePath is empty", () => {
    const result = renderHtml(MOCK_HTML, "");
    expect(result).toContain('<base href="/" />');
    expect(result).not.toContain("__QUEUERT_BASE__");
  });
});

describe("favicon", () => {
  // Needs the frontend build (`pnpm build`), which embeds it into assets.generated.ts.
  it("inlines the shared Queuert favicon into the built page", async () => {
    const { assets } = await import("../api/assets.generated.ts");
    const html = assets["/index.html"]?.content;

    expect(html).toBeDefined();
    expect(html).toContain(`<link rel="icon" type="image/svg+xml" href="${faviconDataUri}">`);
  });
});
