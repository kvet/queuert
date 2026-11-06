// The Queuert mark as SVG markup: two interlocking rounded links and a Q tail crossing over the
// right one. Each crossing cuts a gap into the link underneath. `LogoIcon` renders it, and the
// favicons of the docs site and the dashboard are built from it, so the mark has one source.
// Self-contained (no imports) so Vite configs can load it.

export const logoViewBox = "0 0 78.8 78.8";

const brand = "#8b5cf6"; // --color-brand in tokens.css

export type LogoMarkupOptions = {
  /** Prefix for the mask and clip ids, unique per document. */
  id: string;
  /** Stroke color of the links and the tail: any CSS color, including `var()`. */
  color: string;
};

const link = (x: number, attrs = "") =>
  `<rect x="${x}" y="17" width="40" height="40" rx="15"${attrs ? ` ${attrs}` : ""}/>`;

const tail = (attrs = "") =>
  `<line x1="61.07" y1="49.07" x2="73.8" y2="61.8"${attrs ? ` ${attrs}` : ""}/>`;

const cover = (inner: string) =>
  `<rect width="78.8" height="78.8" fill="white" stroke="none"/>${inner}`;

const mask = (id: string, inner: string) =>
  `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="78.8" height="78.8">${cover(inner)}</mask>`;

/** The mark's inner SVG markup, for an `<svg>` with `viewBox={logoViewBox}`. */
export const logoMarkup = (options: LogoMarkupOptions): string => {
  const { id, color } = options;
  const defs =
    `<clipPath id="${id}-top"><circle cx="37" cy="18.73" r="16"/></clipPath>` +
    `<clipPath id="${id}-bottom"><circle cx="37" cy="55.27" r="16"/></clipPath>` +
    mask(
      `${id}-under-right`,
      link(29, `fill="none" stroke="black" stroke-width="16" clip-path="url(#${id}-bottom)"`),
    ) +
    mask(
      `${id}-under-left`,
      link(5, `fill="none" stroke="black" stroke-width="16" clip-path="url(#${id}-top)"`),
    ) +
    mask(`${id}-under-tail`, tail(`stroke="black" stroke-width="16" stroke-linecap="round"`));
  return (
    `<defs>${defs}</defs>` +
    `<g fill="none" style="stroke:${color}" stroke-width="10" stroke-linecap="round">` +
    `<g mask="url(#${id}-under-right)">${link(5)}</g>` +
    `<g mask="url(#${id}-under-left)"><g mask="url(#${id}-under-tail)">${link(29)}</g></g>` +
    tail() +
    `</g>`
  );
};

// The favicon follows the browser's color scheme: brand violet on light tab bars, a lighter
// violet on dark ones, where brand violet loses contrast.
const faviconPalettes = {
  light: brand,
  dark: "#a78bfa",
};

/** The favicon: the mark as a standalone SVG document with a dark variant. */
export const faviconSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${logoViewBox}">` +
  `<style>svg{--logo:${faviconPalettes.light}}` +
  `@media (prefers-color-scheme:dark){svg{--logo:${faviconPalettes.dark}}}</style>` +
  logoMarkup({ id: "q", color: "var(--logo)" }) +
  `</svg>`;

/** `faviconSvg` as a data URI, for a `<link rel="icon">` that needs no file. */
export const faviconDataUri = `data:image/svg+xml,${encodeURIComponent(faviconSvg)}`;
