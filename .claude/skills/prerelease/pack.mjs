#!/usr/bin/env node
// Builds and packs every public package under packages/ at a prerelease version,
// then verifies the tarballs install and import in a clean npm project.
//
// Usage: node .claude/skills/prerelease/pack.mjs --version <semver> --out <dir>
//
// The version is stamped into packages/*/package.json only for the duration of
// the build and pack; the files are restored from git afterwards, even on failure.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { version: { type: "string" }, out: { type: "string" } },
});
if (!values.version || !values.out) {
  console.error("Usage: pack.mjs --version <semver> --out <dir>");
  process.exit(1);
}
const version = values.version;
if (!/^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(version)) {
  console.error(
    `"${version}" is not a prerelease semver (expected e.g. 0.17.0-pre.20261105.gabc1234)`,
  );
  process.exit(1);
}

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...opts });

const root = run("git", ["rev-parse", "--show-toplevel"]).trim();
const outDir = resolve(values.out);
const tarballDir = join(outDir, "packages");

const packageDirs = readdirSync(join(root, "packages"))
  .map((name) => join(root, "packages", name))
  .filter((dir) => {
    try {
      return !JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).private;
    } catch {
      return false;
    }
  });
const manifestPaths = packageDirs.map((dir) => join(dir, "package.json"));

const dirtyManifests = run("git", ["status", "--porcelain", "--", ...manifestPaths]).trim();
if (dirtyManifests) {
  console.error(
    `Package manifests have uncommitted changes, refusing to stamp a version:\n${dirtyManifests}`,
  );
  process.exit(1);
}

rmSync(tarballDir, { recursive: true, force: true });
mkdirSync(tarballDir, { recursive: true });

const packed = [];
try {
  for (const path of manifestPaths) {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    manifest.version = version;
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  console.log(`Building packages at ${version}...`);
  execFileSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });

  for (const dir of packageDirs) {
    const { name } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const before = new Set(readdirSync(tarballDir));
    run("pnpm", ["pack", "--pack-destination", tarballDir], { cwd: dir });
    const file = readdirSync(tarballDir).find((f) => !before.has(f));
    packed.push({ name, file });
    console.log(`Packed ${name} -> packages/${file}`);
  }
} finally {
  run("git", ["checkout", "--", ...manifestPaths], { cwd: root });
}

const problems = [];
for (const { name, file } of packed) {
  const manifest = JSON.parse(
    run("tar", ["-xOzf", join(tarballDir, file), "package/package.json"]),
  );
  const raw = JSON.stringify(manifest);
  if (manifest.version !== version) problems.push(`${name}: version is ${manifest.version}`);
  if (raw.includes("workspace:"))
    problems.push(`${name}: manifest still contains a workspace: range`);
  if (raw.includes("./src/")) problems.push(`${name}: exports still point at ./src`);
  const contents = run("tar", ["-tzf", join(tarballDir, file)]);
  if (!contents.includes("package/dist/")) problems.push(`${name}: tarball has no dist/`);
}
if (problems.length > 0) {
  console.error(`Tarball verification failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

console.log("Smoke-testing tarballs in a clean npm project...");
const smokeDir = mkdtempSync(join(tmpdir(), "queuert-prerelease-smoke-"));
try {
  writeFileSync(
    join(smokeDir, "package.json"),
    JSON.stringify({ name: "smoke", private: true, type: "module" }, null, 2),
  );
  run(
    "npm",
    ["install", "--no-audit", "--no-fund", ...packed.map(({ file }) => join(tarballDir, file))],
    { cwd: smokeDir },
  );
  const script = packed
    .map(
      ({ name }) =>
        `await import(${JSON.stringify(name)}); console.log("  import ok:", ${JSON.stringify(name)});`,
    )
    .join("\n");
  execFileSync("node", ["--input-type=module", "-e", script], { cwd: smokeDir, stdio: "inherit" });
} finally {
  rmSync(smokeDir, { recursive: true, force: true });
}

console.log(`\nAll ${packed.length} packages packed and verified in ${tarballDir}`);
