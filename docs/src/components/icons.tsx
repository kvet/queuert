import { Icon, type IconProps } from "@queuert/ui/components";

export const GitHubIcon = (props: IconProps) => (
  <svg
    width={props.size ?? 16}
    height={props.size ?? 16}
    viewBox="0 0 16 16"
    fill="currentColor"
    class={props.class}
    aria-hidden="true"
  >
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

export const ArrowRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </Icon>
);

export const TransactionIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 2.5H3.5v11H5M11 2.5h1.5v11H11" />
    <path d="m5.75 8.25 1.75 1.75 3-4" />
  </Icon>
);

export const ChainIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.5 9.5 9.5 6.5" />
    <path d="M7.25 4.75 8.5 3.5a2.83 2.83 0 0 1 4 4l-1.25 1.25" />
    <path d="M8.75 11.25 7.5 12.5a2.83 2.83 0 0 1-4-4l1.25-1.25" />
  </Icon>
);

export const DatabaseIcon = (props: IconProps) => (
  <Icon {...props}>
    <ellipse cx="8" cy="3.75" rx="5" ry="1.75" />
    <path d="M3 3.75v8.5c0 .97 2.24 1.75 5 1.75s5-.78 5-1.75v-8.5" />
    <path d="M3 8c0 .97 2.24 1.75 5 1.75S13 8.97 13 8" />
  </Icon>
);

export const BoltIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8l1-5.5Z" />
  </Icon>
);

export const MergeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2 3.5h2.5L8 8M2 12.5h2.5L8 8M2 8h11.5" />
    <path d="m11 5.5 2.5 2.5-2.5 2.5" />
  </Icon>
);

export const ClockIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.75V8l2.25 1.5" />
  </Icon>
);

export const KeyIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="5.5" cy="10.5" r="3" />
    <path d="M7.6 8.4 13.5 2.5M11.5 4.5l1.5 1.5M10 6l1 1" />
  </Icon>
);

export const ShieldIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 1.5 13 3.5v4c0 3.1-2.1 5.6-5 7-2.9-1.4-5-3.9-5-7v-4l5-2Z" />
    <path d="m5.75 8 1.5 1.5 3-3" />
  </Icon>
);

export const ScaleIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 2v12M5 14h6M3 4.5h10" />
    <path d="M3 4.5 1.5 9a1.5 1.5 0 0 0 3 0L3 4.5ZM13 4.5 11.5 9a1.5 1.5 0 0 0 3 0L13 4.5Z" />
  </Icon>
);

export const ExternalLinkIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5" />
    <path d="M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
  </Icon>
);

export const PackageIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m8 1.75 5.5 3v6.5L8 14.25l-5.5-3v-6.5L8 1.75Z" />
    <path d="M2.5 4.75 8 7.75l5.5-3M8 7.75v6.5" />
  </Icon>
);

export const TagIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2 2.5v4.6l6.4 6.4a1 1 0 0 0 1.4 0l3.7-3.7a1 1 0 0 0 0-1.4L7.1 2H2.5a.5.5 0 0 0-.5.5Z" />
    <circle cx="5" cy="5" r=".75" fill="currentColor" />
  </Icon>
);
