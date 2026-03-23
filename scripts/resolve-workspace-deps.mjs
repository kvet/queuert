/**
 * Prepares package.json files for publishing. This is needed because
 * `changeset publish` (which uses npm publish internally) does not:
 *
 * 1. Resolve workspace:* / workspace:^ references to real versions
 * 2. Apply publishConfig overrides (e.g. exports pointing to dist/)
 *
 * pnpm publish handled both automatically, but after the switch to bun +
 * changeset publish (9a61518) these transforms were lost.
 *
 * Run this before `changeset publish` in the CI pipeline.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const packagesDir = join(import.meta.dirname, "..", "packages");

// Build a map of package name → version from all workspace packages
const versionMap = new Map();

for (const dir of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const pkgPath = join(packagesDir, dir.name, "package.json");
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    versionMap.set(pkg.name, pkg.version);
  } catch {
    // skip directories without package.json
  }
}

let changed = 0;

for (const dir of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const pkgPath = join(packagesDir, dir.name, "package.json");
  let raw;
  try {
    raw = readFileSync(pkgPath, "utf-8");
  } catch {
    continue;
  }

  const pkg = JSON.parse(raw);
  let modified = false;

  // 1. Apply publishConfig overrides (replicates pnpm publish behavior)
  if (pkg.publishConfig) {
    for (const [key, value] of Object.entries(pkg.publishConfig)) {
      pkg[key] = value;
      modified = true;
      console.log(`  ${pkg.name}: publishConfig.${key} applied`);
    }
    delete pkg.publishConfig;
  }

  // 2. Resolve workspace references in dependencies and peerDependencies
  for (const field of ["dependencies", "peerDependencies"]) {
    const deps = pkg[field];
    if (!deps) continue;

    for (const [name, range] of Object.entries(deps)) {
      if (!range.startsWith("workspace:")) continue;

      const version = versionMap.get(name);
      if (!version) {
        console.warn(`  warning: ${pkg.name} → ${name} not found in workspace`);
        continue;
      }

      const protocol = range.slice("workspace:".length); // "*", "^", "~"
      let resolved;
      if (protocol === "*") {
        resolved = version;
      } else {
        // "^" → "^0.8.1", "~" → "~0.8.1"
        resolved = `${protocol}${version}`;
      }

      deps[name] = resolved;
      modified = true;
      console.log(`  ${pkg.name}: ${field}.${name} → ${resolved}`);
    }
  }

  if (modified) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    changed++;
  }
}

console.log(`\nPrepared ${changed} package(s) for publishing.`);
