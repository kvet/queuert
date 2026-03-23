/**
 * Resolves workspace:* and workspace:^ references in package.json files
 * before publishing. This is needed because `changeset publish` (which uses
 * npm publish internally) does not understand the workspace: protocol.
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

// Resolve workspace references in dependencies and peerDependencies
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

console.log(`\nResolved workspace references in ${changed} package(s).`);
