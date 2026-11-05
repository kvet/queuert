import { Aside } from "../mdx/Aside.tsx";

/**
 * The notice every page of an experimental package shows right after its lead paragraph, so the
 * wording stays the same everywhere. Packages marked `@experimental` in their TSDoc get one.
 */
export const ExperimentalAside = (props: { package: string }) => (
  <Aside type="caution" title="Experimental">
    <code>{props.package}</code> is experimental: its API may change in a minor release.
  </Aside>
);
