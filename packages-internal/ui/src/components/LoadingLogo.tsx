import { type JSX, createUniqueId } from "solid-js";

import { logoViewBox } from "../lib/logo.ts";

/**
 * The Queuert mark animated as a loading indicator: the two links draw in one after the other,
 * then the Q tail, then a bead keeps circling each link half a lap apart. Same geometry as
 * `LogoIcon`; styles and timing are the `.loading-logo` rules in base.css. With reduced motion it
 * shows the static mark.
 */
export const LoadingLogo = (props: { class?: string; size?: number }) => {
  const id = createUniqueId();
  const link = (x: number, attrs: JSX.SvgSVGAttributes<SVGRectElement> = {}) => (
    <rect x={x} y="17" width="40" height="40" rx="15" pathLength="100" {...attrs} />
  );
  const tail = (attrs: JSX.SvgSVGAttributes<SVGLineElement> = {}) => (
    <line x1="61.07" y1="49.07" x2="73.8" y2="61.8" pathLength="100" {...attrs} />
  );
  const under = (maskId: string, overX: number, crossY: number) => (
    <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="78.8" height="78.8">
      <rect width="78.8" height="78.8" fill="white" stroke="none" />
      <clipPath id={`${maskId}-clip`}>
        <circle cx="37" cy={crossY} r="16" />
      </clipPath>
      {link(overX, { stroke: "black", "stroke-width": 16, "clip-path": `url(#${maskId}-clip)` })}
    </mask>
  );
  const beads = (x: number, side: "a" | "b") => (
    <>
      {link(x, { class: `loading-logo-bead loading-logo-bead-rim loading-logo-${side}` })}
      {link(x, { class: `loading-logo-bead loading-logo-${side}` })}
    </>
  );
  return (
    <svg
      width={props.size ?? 48}
      height={props.size ?? 48}
      viewBox={logoViewBox}
      fill="none"
      stroke="currentColor"
      stroke-width="10"
      stroke-linecap="round"
      class={`loading-logo ${props.class ?? ""}`}
      aria-hidden="true"
    >
      {under(`${id}-a`, 29, 55.27)}
      {under(`${id}-b`, 5, 18.73)}
      <mask id={`${id}-t`} maskUnits="userSpaceOnUse" x="0" y="0" width="78.8" height="78.8">
        <rect width="78.8" height="78.8" fill="white" stroke="none" />
        {tail({ stroke: "black", "stroke-width": 16 })}
      </mask>
      <g mask={`url(#${id}-a)`}>
        {link(5, { class: "loading-logo-draw loading-logo-a" })}
        {beads(5, "a")}
      </g>
      <g mask={`url(#${id}-b)`}>
        <g mask={`url(#${id}-t)`}>
          {link(29, { class: "loading-logo-draw loading-logo-b" })}
          {beads(29, "b")}
        </g>
      </g>
      {tail({ class: "loading-logo-draw loading-logo-tail" })}
    </svg>
  );
};
