import { type Accessor, createSignal } from "solid-js";

export type ThemePreference = "system" | "light" | "dark";

export const parseThemePreference = (stored: string | null): ThemePreference =>
  stored === "light" || stored === "dark" ? stored : "system";

export const resolveTheme = (preference: ThemePreference, systemDark: boolean): "light" | "dark" =>
  preference === "system" ? (systemDark ? "dark" : "light") : preference;

const order: ThemePreference[] = ["system", "light", "dark"];

export const nextThemePreference = (preference: ThemePreference): ThemePreference =>
  order[(order.indexOf(preference) + 1) % order.length];

export type Theme = {
  preference: Accessor<ThemePreference>;
  setPreference: (next: ThemePreference) => void;
  init: () => void;
};

export const createTheme = (storageKey: string): Theme => {
  const [preference, setPreferenceSignal] = createSignal<ThemePreference>("system");
  const media = () => window.matchMedia("(prefers-color-scheme: dark)");

  const apply = () => {
    document.documentElement.dataset.theme = resolveTheme(preference(), media().matches);
  };

  return {
    preference,
    setPreference: (next) => {
      setPreferenceSignal(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {}
      apply();
    },
    init: () => {
      try {
        setPreferenceSignal(parseThemePreference(localStorage.getItem(storageKey)));
      } catch {}
      apply();
      media().addEventListener("change", () => {
        if (preference() === "system") apply();
      });
    },
  };
};
