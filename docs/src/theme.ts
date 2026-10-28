import { createTheme } from "@queuert/ui/lib";

const themeStorageKey = "queuert-docs:theme";

export const theme = createTheme(themeStorageKey);

export const themeScript = `(() => {
  try {
    const stored = localStorage.getItem("${themeStorageKey}");
    const dark = stored === "dark" || (stored !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch {}
})();`;
