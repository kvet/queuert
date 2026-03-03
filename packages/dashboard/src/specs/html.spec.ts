import { describe, expect, it } from "vitest";
import { renderHtml } from "../api/html.js";

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
