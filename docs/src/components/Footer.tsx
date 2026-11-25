import { LogoIcon } from "@queuert/ui/components";
import corePackage from "queuert/package.json";
import { For } from "solid-js";

import { siteHref } from "../docs/href.ts";
import { sectionById, topBarSections } from "../docs/sections.ts";
import { siteDescription } from "../docs/site.ts";
import { GitHubIcon } from "./icons.tsx";
import { HeroSquares } from "./landing/HeroSquares.tsx";

const github = "https://github.com/kvet/queuert";

type FooterLink = { label: string; href: string; external?: boolean };

const columns: { title: string; links: FooterLink[] }[] = [
  {
    title: "Learn",
    links: [
      { label: "What is Queuert", href: siteHref("/learn/what-is-queuert/") },
      { label: "Basics", href: siteHref("/learn/") },
      { label: "Use it in your app", href: siteHref("/learn/use-it-in-your-app/") },
    ],
  },
  {
    title: "Docs",
    links: topBarSections
      .filter((section) => section.id !== "learn" && section.id !== "compare")
      .map((section) => ({ label: section.label, href: siteHref(section.href) })),
  },
  {
    title: "Compare",
    links: [
      { label: "Alternatives", href: siteHref("/comparison/#alternatives") },
      { label: "Benchmarks", href: siteHref("/comparison/#benchmarks") },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "GitHub", href: github, external: true },
      { label: "npm", href: "https://www.npmjs.com/package/queuert", external: true },
      { label: "Releases", href: `${github}/releases`, external: true },
      { label: "Changelog", href: siteHref(sectionById("changelog").href) },
      { label: "Blog", href: siteHref(sectionById("blog").href) },
    ],
  },
];

/** The site footer: the project in a line, links to each part of the docs and the project, on the square grid. */
export const Footer = () => (
  <footer class="relative isolate mt-16 overflow-hidden border-t border-border bg-bg">
    <HeroSquares
      id="footer-squares"
      mask="[mask-image:linear-gradient(to_top,black,transparent_85%)]"
    />
    <div class="relative mx-auto flex max-w-360 flex-col gap-10 px-4 py-14 sm:px-6 lg:flex-row lg:justify-between">
      <div class="flex max-w-sm flex-col">
        <a
          href={siteHref("/")}
          class="flex w-max items-center gap-2 font-mono text-lg font-semibold text-fg"
        >
          <LogoIcon size={24} class="text-brand" />
          Queuert
        </a>
        <p class="mt-4 text-sm leading-6 text-fg-muted">{siteDescription}</p>
        <div class="mt-5 flex flex-wrap items-center gap-3 text-[13px] text-fg-muted">
          <a
            href={github}
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-1.5 rounded-xs border border-border bg-bg px-2.5 py-1 hover:border-border-strong hover:text-fg"
          >
            <GitHubIcon size={14} />
            kvet/queuert
          </a>
          <span class="font-mono">v{corePackage.version}</span>
          <span>MIT License</span>
        </div>
      </div>
      <nav
        aria-label="Footer"
        class="grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4 lg:max-w-3xl"
      >
        <For each={columns}>
          {(column) => (
            <div>
              <p class="font-mono text-xs font-semibold tracking-wide text-fg uppercase">
                {column.title}
              </p>
              <ul class="mt-4 flex flex-col gap-2.5 text-sm">
                <For each={column.links}>
                  {(link) => (
                    <li>
                      <a
                        href={link.href}
                        class="text-fg-muted underline decoration-transparent underline-offset-4 hover:text-brand hover:decoration-current"
                        {...(link.external ? { target: "_blank", rel: "noopener" } : {})}
                      >
                        {link.label}
                      </a>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          )}
        </For>
      </nav>
    </div>
  </footer>
);
