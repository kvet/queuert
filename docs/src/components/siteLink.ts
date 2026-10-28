import { type LinkComponent } from "@queuert/ui/components";
import { A } from "@solidjs/router";

export const siteLink = (href: string): LinkComponent | undefined =>
  href.startsWith("/") ? A : undefined;
