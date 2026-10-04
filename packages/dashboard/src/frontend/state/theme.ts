import { type Accessor, createSignal } from "solid-js";

import { basePath } from "../base.js";
import { readStored, storageKey, writeStored } from "./storage.js";

export type ThemePreference = "system" | "light" | "dark";

const key = storageKey(basePath, "theme");
const media = window.matchMedia("(prefers-color-scheme: dark)");

const readPreference = (): ThemePreference => {
  const stored = readStored(key);
  return stored === "light" || stored === "dark" ? stored : "system";
};

const [preference, setPreferenceSignal] = createSignal<ThemePreference>(readPreference());

const apply = () => {
  const resolved = preference() === "system" ? (media.matches ? "dark" : "light") : preference();
  document.documentElement.dataset.theme = resolved;
};

export const themePreference: Accessor<ThemePreference> = preference;

export const setThemePreference = (next: ThemePreference): void => {
  setPreferenceSignal(next);
  writeStored(key, next);
  apply();
};

/** Applies the stored theme to `<html data-theme>`; call once before the first render. */
export const initTheme = (): void => {
  apply();
  media.addEventListener("change", () => {
    if (preference() === "system") apply();
  });
};
