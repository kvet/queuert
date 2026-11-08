import { describe, expect, it } from "vitest";

import {
  nextThemePreference,
  parseThemePreference,
  resolveTheme,
  storedThemePreferenceChange,
} from "./theme.ts";

describe("parseThemePreference", () => {
  it("keeps a stored light or dark preference", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
  });

  it("falls back to system for a missing or unknown value", () => {
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference("sepia")).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("follows the system theme only for the system preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("nextThemePreference", () => {
  it("cycles system → light → dark → system", () => {
    expect(nextThemePreference("system")).toBe("light");
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
  });
});

describe("storedThemePreferenceChange", () => {
  it("reads the preference another document stored under the same key", () => {
    expect(storedThemePreferenceChange("site:theme", { key: "site:theme", newValue: "dark" })).toBe(
      "dark",
    );
    expect(storedThemePreferenceChange("site:theme", { key: "site:theme", newValue: null })).toBe(
      "system",
    );
  });

  it("falls back to system when another document clears the storage", () => {
    expect(storedThemePreferenceChange("site:theme", { key: null, newValue: null })).toBe("system");
  });

  it("ignores changes to other keys", () => {
    expect(
      storedThemePreferenceChange("site:theme", { key: "other:theme", newValue: "dark" }),
    ).toBeUndefined();
  });
});
