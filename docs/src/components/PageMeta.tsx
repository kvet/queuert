import { Link, Meta, Title } from "@solidjs/meta";
import { Show } from "solid-js";

import { absoluteUrl, siteName } from "../docs/site.ts";

export const PageMeta = (props: { title: string; description: string | null; path: string }) => (
  <>
    <Title>{props.title}</Title>
    <Link rel="canonical" href={absoluteUrl(props.path)} />
    <Meta property="og:type" content="website" />
    <Meta property="og:site_name" content={siteName} />
    <Meta property="og:title" content={props.title} />
    <Meta property="og:url" content={absoluteUrl(props.path)} />
    <Meta name="twitter:card" content="summary" />
    <Show when={props.description}>
      {(description) => (
        <>
          <Meta name="description" content={description()} />
          <Meta property="og:description" content={description()} />
        </>
      )}
    </Show>
  </>
);
