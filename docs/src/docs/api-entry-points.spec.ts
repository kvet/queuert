import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { apiEntryPoints } from "./api-entry-points.ts";

const packagesDirectory = fileURLToPath(new URL("../../../packages", import.meta.url));

describe("apiEntryPoints", () => {
  it("names a subpath export after its package", () => {
    expect(
      apiEntryPoints.find((entryPoint) => entryPoint.slug === "postgres-conformance"),
    ).toMatchObject({
      label: "@queuert/postgres/conformance",
      packageName: "@queuert/postgres",
      source: "src/conformance.ts",
    });
    expect(apiEntryPoints.find((entryPoint) => entryPoint.slug === "core")).toMatchObject({
      label: "queuert",
      packageName: "queuert",
      source: "src/index.ts",
    });
  });

  it("gives every entry point its own slug", () => {
    const slugs = apiEntryPoints.map((entryPoint) => entryPoint.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("points every entry point at an existing source file", async () => {
    for (const entryPoint of apiEntryPoints) {
      await expect(
        access(`${packagesDirectory}/${entryPoint.dir}/${entryPoint.source}`),
      ).resolves.toBeUndefined();
    }
  });
});
