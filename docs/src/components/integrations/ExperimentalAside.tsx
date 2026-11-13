import { Aside } from "../mdx/Aside.tsx";

/**
 * The notice every page of an experimental package shows right after its lead paragraph, so the
 * wording stays the same everywhere. Packages marked `@experimental` in their TSDoc get one; when
 * only part of a package is experimental, `subject` names that part.
 */
export const ExperimentalAside = (props: { package: string; subject?: string }) => (
  <Aside type="caution" title="Experimental">
    {props.subject === undefined ? (
      <code>{props.package}</code>
    ) : (
      <>
        {props.subject} in <code>{props.package}</code>
      </>
    )}{" "}
    is experimental: its API may change in a minor release.
  </Aside>
);
