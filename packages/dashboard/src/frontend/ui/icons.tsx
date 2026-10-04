import { type JSX, createUniqueId } from "solid-js";

// Inline SVG only: the embed plugin serves html/js/css as text, so emitted image files would break.

type IconProps = { class?: string; size?: number };

const Icon = (props: IconProps & { children: JSX.Element; viewBox?: string }) => (
  <svg
    width={props.size ?? 16}
    height={props.size ?? 16}
    viewBox={props.viewBox ?? "0 0 16 16"}
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={props.class}
    aria-hidden="true"
  >
    {props.children}
  </svg>
);

// Same artwork as docs/public/favicon.svg: two woven chain links, the second with a Q tail. Each
// link is masked where it passes under the other; ids are per instance since the SVG is inlined.
export const LogoIcon = (props: IconProps) => {
  const id = createUniqueId();
  const link = (x: number, attrs: JSX.SvgSVGAttributes<SVGRectElement> = {}) => (
    <rect x={x} y="17" width="40" height="40" rx="15" {...attrs} />
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
  return (
    <Icon {...props} viewBox="0 0 78.8 78.8">
      {under(`${id}-a`, 29, 55.27)}
      {under(`${id}-b`, 5, 18.73)}
      <g stroke-width="10">
        {link(5, { mask: `url(#${id}-a)` })}
        <g mask={`url(#${id}-b)`}>
          {link(29)}
          <line x1="64.61" y1="52.61" x2="73.8" y2="61.8" />
        </g>
      </g>
    </Icon>
  );
};

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3.5 3.5" />
  </Icon>
);

export const RefreshIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
    <path d="M13.5 2.5v3h-3" />
  </Icon>
);

export const ChevronDownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m4 6 4 4 4-4" />
  </Icon>
);

export const ChevronRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 4 4 4-4 4" />
  </Icon>
);

export const SunIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
  </Icon>
);

export const MoonIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" />
  </Icon>
);

export const MonitorIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" />
    <path d="M5.5 14h5M8 11v3" />
  </Icon>
);

export const DocsIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 2.5A1.5 1.5 0 0 1 4.5 1h5l3.5 3.5v9A1.5 1.5 0 0 1 11.5 15h-7A1.5 1.5 0 0 1 3 13.5v-11Z" />
    <path d="M5.5 8h5M5.5 10.5h5" />
  </Icon>
);

export const CopyIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" />
    <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m3 8.5 3 3 7-7" />
  </Icon>
);

export const WarningIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7.1 2.4a1 1 0 0 1 1.8 0l5.5 10.1a1 1 0 0 1-.9 1.5H2.5a1 1 0 0 1-.9-1.5L7.1 2.4Z" />
    <path d="M8 6.5v3M8 11.6v.1" />
  </Icon>
);

export const ArrowLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13 8H3M7 4 3 8l4 4" />
  </Icon>
);

export const ArrowUpIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Icon>
);

export const ArrowDownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </Icon>
);

export const MenuIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
);

export const MoreIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="3.5" cy="8" r=".75" fill="currentColor" />
    <circle cx="8" cy="8" r=".75" fill="currentColor" />
    <circle cx="12.5" cy="8" r=".75" fill="currentColor" />
  </Icon>
);
