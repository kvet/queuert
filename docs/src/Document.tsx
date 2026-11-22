import { faviconDataUri } from "@queuert/ui/logo";
import { HydrationScript, type JSX } from "@solidjs/web";

import { stackScript, stackStyle } from "./stack.ts";
import { themeScript } from "./theme.ts";

const Document = (props: { children: JSX.Element }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <link rel="icon" type="image/svg+xml" href={faviconDataUri} />
      <script innerHTML={themeScript} />
      <script innerHTML={stackScript} />
      <style innerHTML={stackStyle} />
      <HydrationScript />
    </head>
    <body>
      <div id="app">{props.children}</div>
    </body>
  </html>
);

export default Document;
