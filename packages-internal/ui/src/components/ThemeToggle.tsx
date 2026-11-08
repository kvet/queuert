import { Show } from "solid-js";

import { type Theme, type ThemePreference, nextThemePreference } from "../lib/theme.ts";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons.tsx";
import { iconButtonClass } from "./TopBar.tsx";

const labels: Record<ThemePreference, string> = { system: "System", light: "Light", dark: "Dark" };

export const ThemeToggle = (props: { theme: Theme }) => {
  const current = () => props.theme.preference();
  const next = () => nextThemePreference(current());
  return (
    <button
      type="button"
      class={iconButtonClass}
      title={`Theme: ${labels[current()]} (switch to ${labels[next()]})`}
      aria-label={`Theme: ${labels[current()]}. Switch to ${labels[next()]}`}
      onClick={() => {
        props.theme.setPreference(next());
      }}
    >
      <Show when={current() !== "system"} fallback={<MonitorIcon />}>
        <Show when={current() === "dark"} fallback={<SunIcon />}>
          <MoonIcon />
        </Show>
      </Show>
    </button>
  );
};
