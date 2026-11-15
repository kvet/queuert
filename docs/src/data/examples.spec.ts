import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { type ExampleService, exampleSlug, examples } from "./examples.ts";

const examplesDirectory = fileURLToPath(new URL("../../../examples/", import.meta.url));
const integrationsDirectory = fileURLToPath(
  new URL("../content/docs/integrations/", import.meta.url),
);

const sourceOf = (name: string): string =>
  readdirSync(`${examplesDirectory}${name}/src`, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".spec.ts"))
    .map((file) => readFileSync(`${examplesDirectory}${name}/src/${file}`, "utf8"))
    .join("\n");

const containerHelpers: Record<ExampleService, RegExp> = {
  PostgreSQL: /\bacquirePostgres\(/,
  MySQL: /\bacquireMysql\(/,
  Redis: /\bacquireRedis\(/,
  "Redis Cluster": /\bacquireRedisCluster\(/,
  NATS: /\bacquireNats\(/,
};

describe.each(examples)("$name", (example) => {
  const packageJson = JSON.parse(
    readFileSync(`${examplesDirectory}${example.name}/package.json`, "utf8"),
  ) as { name: string; scripts: Record<string, string> };

  test("names the containers its source starts", () => {
    const source = sourceOf(example.name);
    const started = (Object.keys(containerHelpers) as ExampleService[]).filter((service) =>
      containerHelpers[service].test(source),
    );
    expect(example.services.toSorted()).toEqual(started.toSorted());
  });

  test("links key files that exist", () => {
    for (const file of example.files) {
      expect(existsSync(`${examplesDirectory}${example.name}/${file}`), file).toBe(true);
    }
  });

  test("runs scripts the package defines, under its package name", () => {
    expect(packageJson.name).toBe(`example-${exampleSlug(example.name)}`);
    for (const { script } of example.commands ?? [{ script: "start" }]) {
      expect(packageJson.scripts[script], script).toBeDefined();
    }
    expect(packageJson.scripts.start?.startsWith("bun ")).toBe(example.runtime === "Bun");
  });

  test("appears on an integrations page", () => {
    const pages = readdirSync(integrationsDirectory, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => readFileSync(`${integrationsDirectory}${file}`, "utf8"));
    expect(pages.some((page) => page.includes(`"${example.name}"`))).toBe(true);
  });
});
