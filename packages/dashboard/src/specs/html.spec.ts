import { describe, expect, it } from "vitest";
import { normalizeMountPath, renderHtml } from "../api/html.js";

const MOCK_HTML = [
  "<!DOCTYPE html><html>",
  '<head><link rel="stylesheet" href="assets/index-abc12345.css"></head>',
  '<body><script type="module" src="assets/index-abc12345.js"></script></body>',
  "</html>",
].join("");

describe("normalizeMountPath", () => {
  it("adds trailing slash to sub-path without slash", () => {
    expect(normalizeMountPath("/internal/queuert")).toBe("/internal/queuert/");
  });

  it("preserves trailing slash", () => {
    expect(normalizeMountPath("/internal/queuert/")).toBe("/internal/queuert/");
  });

  it("normalizes root path", () => {
    expect(normalizeMountPath("/")).toBe("/");
  });

  it("strips SPA route segments and keeps trailing slash", () => {
    expect(normalizeMountPath("/dash/chains/abc-123")).toBe("/dash/");
    expect(normalizeMountPath("/dash/jobs/xyz-789/detail")).toBe("/dash/");
  });

  it("sanitizes invalid characters", () => {
    expect(normalizeMountPath("/valid/<script>")).toBe("/valid/script/");
  });
});

describe("renderHtml", () => {
  it("injects base href", () => {
    const result = renderHtml(MOCK_HTML, "/app/");
    expect(result).toContain('<base href="/app/" />');
  });

  it("injects nonce into script, link, and style tags when provided", () => {
    const html = MOCK_HTML.replace("</head>", "<style>body{}</style></head>");
    const result = renderHtml(html, "/", "abc123");
    expect(result).toContain('<script nonce="abc123"');
    expect(result).toContain('<link nonce="abc123"');
    expect(result).toContain('<style nonce="abc123"');
    expect(result).not.toMatch(/<script(?! nonce=)/);
    expect(result).not.toMatch(/<link(?! nonce=)/);
    expect(result).not.toMatch(/<style(?! nonce=)/);
  });

  it("does not inject nonce when not provided", () => {
    const result = renderHtml(MOCK_HTML, "/");
    expect(result).toContain('<script type="module"');
    expect(result).toContain("<link rel=");
    expect(result).not.toContain("nonce");
  });
});
