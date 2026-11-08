import { describe, expect, it } from "vitest";

import { faviconDataUri, faviconSvg, logoMarkup } from "./logo.ts";

const ids = (markup: string) => [...markup.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
const references = (markup: string) =>
  [...markup.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]);

describe("logoMarkup", () => {
  it("prefixes every mask and clip id, and references only those", () => {
    const markup = logoMarkup({ id: "x1", color: "currentColor" });
    const defined = ids(markup);
    expect(defined.length).toBeGreaterThan(0);
    expect(defined.every((id) => id.startsWith("x1-"))).toBe(true);
    expect(new Set(references(markup))).toEqual(new Set(defined));
  });
});

describe("faviconSvg", () => {
  it("switches its palette for dark color schemes", () => {
    expect(faviconSvg).toMatch(/<style>svg\{--logo:#[0-9a-f]{6}\}/);
    expect(faviconSvg).toMatch(/@media \(prefers-color-scheme:dark\)\{svg\{--logo:#[0-9a-f]{6}\}/);
    expect(faviconSvg).toContain('style="stroke:var(--logo)"');
  });
});

describe("faviconDataUri", () => {
  it("encodes the standalone favicon document", () => {
    expect(faviconSvg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(decodeURIComponent(faviconDataUri.slice("data:image/svg+xml,".length))).toBe(faviconSvg);
  });
});
