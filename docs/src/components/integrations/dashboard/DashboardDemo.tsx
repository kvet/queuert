import { LoadingLogo } from "@queuert/ui/components";
import { dashboardStorageKey, parseThemePreference } from "@queuert/ui/lib";
import { Show, createEffect, createRoot, createSignal, onMount } from "solid-js";

import { theme } from "../../../theme.ts";
import type { DashboardDemoView } from "./demo/seed.ts";

let demo: Promise<string> | undefined;

const untilActivated = async (registration: ServiceWorkerRegistration): Promise<void> => {
  if (registration.active) return;
  const pending = registration.installing ?? registration.waiting;
  if (!pending) throw new Error("The dashboard demo service worker did not install");
  return new Promise((resolve, reject) => {
    pending.addEventListener("statechange", () => {
      if (pending.state === "activated") resolve();
      if (pending.state === "redundant") {
        reject(new Error("The dashboard demo service worker failed to install"));
      }
    });
  });
};

const syncTheme = (scopePath: string) => {
  const key = dashboardStorageKey(scopePath.replace(/\/$/, ""), "theme");
  createRoot(() => {
    createEffect(() => {
      try {
        localStorage.setItem(key, theme.preference());
      } catch {}
    });
  });
  window.addEventListener("storage", (event) => {
    if (event.key === key) theme.setPreference(parseThemePreference(event.newValue));
  });
};

const startDemo = async (): Promise<string> => {
  const scriptUrl = new URL(`${import.meta.env.BASE_URL}dashboard-demo.js`, location.href);
  const scopePath = new URL("dashboard-demo/", scriptUrl).pathname;
  await untilActivated(await navigator.serviceWorker.register(scriptUrl, { scope: scopePath }));
  syncTheme(scopePath);
  return scopePath;
};

/**
 * A live dashboard in a bordered iframe, opened at one view. A service worker runs the
 * dashboard's `fetch` handler over an in-memory Queuert client seeded with the dashboard
 * example's scenarios, so every frame shows the same chains, jobs and workers, and redirects
 * `__view/<view>` to that view's seeded path. The frame's theme follows the site's.
 */
export const DashboardDemo = (props: { view: DashboardDemoView; title: string }) => {
  const [scopePath, setScopePath] = createSignal<string>();
  const [failure, setFailure] = createSignal<string>();
  const [frameLoaded, setFrameLoaded] = createSignal(false);

  onMount(() => {
    if (!("serviceWorker" in navigator)) {
      setFailure("The dashboard demo needs service workers, which this browser has turned off.");
      return;
    }
    demo ??= startDemo();
    demo.then(setScopePath, (error: unknown) => {
      console.error(error);
      demo = undefined;
      setFailure("The dashboard demo failed to start. Reload the page to try again.");
    });
  });

  return (
    <div class="relative my-4 h-[560px] overflow-hidden rounded-xs border border-border bg-bg">
      <Show when={scopePath()}>
        {(path) => (
          <iframe
            src={`${path()}__view/${props.view}`}
            title={props.title}
            loading="lazy"
            class={`block h-full w-full transition-opacity duration-200 ${frameLoaded() ? "opacity-100" : "opacity-0"}`}
            onLoad={() => setFrameLoaded(true)}
          />
        )}
      </Show>
      <Show when={!frameLoaded()}>
        <div
          role="status"
          class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-fg-muted"
        >
          <Show
            when={failure()}
            fallback={
              <>
                <LoadingLogo size={48} class="text-brand" />
                <span>Starting the dashboard…</span>
              </>
            }
          >
            {(message) => <span>{message()}</span>}
          </Show>
        </div>
      </Show>
    </div>
  );
};
