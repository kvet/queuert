/**
 * Generates a typecheck benchmark file with N slices × M types per slice.
 *
 * Usage: node packages/core/src/entities/generate-bench-types.mjs [slices] [typesPerSlice]
 * Default: 100 slices × 20 types = 2000 total job types
 *
 * The generated file exercises ChainReachMap (the O(N×E) bottleneck)
 * via ChainTypesReaching after merging all slices.
 */

const SLICES = parseInt(process.argv[2] ?? "100", 10);
const TYPES_PER_SLICE = parseInt(process.argv[3] ?? "20", 10);

const lines = [];

lines.push(`/**`);
lines.push(
  ` * Auto-generated benchmark: ${SLICES} slices × ${TYPES_PER_SLICE} types = ${SLICES * TYPES_PER_SLICE} total.`,
);
lines.push(` * Validates that slice-aware ChainReachMap completes typecheck in reasonable time.`);
lines.push(` *`);
lines.push(
  ` * Regenerate: node packages/core/src/entities/generate-bench-types.mjs ${SLICES} ${TYPES_PER_SLICE}`,
);
lines.push(` */`);
lines.push(`import { expectTypeOf } from "vitest";`);
lines.push(`import { type JobTypeRegistryDefinitions } from "./job-type-registry.js";`);
lines.push(`import {`);
lines.push(`  type ChainJobTypeNames,`);
lines.push(`  type ChainTypesReaching,`);
lines.push(`  type EntryJobTypeDefinitions,`);
lines.push(`  defineJobTypes,`);
lines.push(`} from "./job-type.js";`);
lines.push(`import { mergeJobTypeRegistries } from "./merge-job-type-registries.js";`);
lines.push(``);

// Generate each slice
for (let s = 0; s < SLICES; s++) {
  lines.push(`const slice${s} = defineJobTypes<{`);
  for (let t = 0; t < TYPES_PER_SLICE; t++) {
    const name = `s${s}-t${t}`;
    if (t === 0) {
      // Entry point
      if (t === TYPES_PER_SLICE - 1) {
        // Single-type slice (entry + terminal)
        lines.push(
          `  "${name}": { entry: true; input: { s: ${s}; t: ${t} }; output: { s: ${s}; done: true } };`,
        );
      } else {
        lines.push(
          `  "${name}": { entry: true; input: { s: ${s}; t: ${t} }; continueWith: { typeName: "s${s}-t${t + 1}" } };`,
        );
      }
    } else if (t === TYPES_PER_SLICE - 1) {
      // Terminal
      lines.push(`  "${name}": { input: { s: ${s}; t: ${t} }; output: { s: ${s}; done: true } };`);
    } else {
      // Continuation
      lines.push(
        `  "${name}": { input: { s: ${s}; t: ${t} }; continueWith: { typeName: "s${s}-t${t + 1}" } };`,
      );
    }
  }
  lines.push(`}>();`);
  lines.push(``);
}

// Merge in groups of 10, then merge the groups.
// TagSlice uses Omit to strip prior __slice, so nested merges re-tag correctly.
const GROUP_SIZE = 10;
const groups = [];
for (let i = 0; i < SLICES; i += GROUP_SIZE) {
  const end = Math.min(i + GROUP_SIZE, SLICES);
  const groupSlices = [];
  for (let j = i; j < end; j++) {
    groupSlices.push(`slice${j}`);
  }
  const groupName = `group${Math.floor(i / GROUP_SIZE)}`;
  if (groupSlices.length === 1) {
    lines.push(`const ${groupName} = ${groupSlices[0]};`);
  } else {
    lines.push(`const ${groupName} = mergeJobTypeRegistries(${groupSlices.join(", ")});`);
  }
  groups.push(groupName);
}
lines.push(``);

if (groups.length === 1) {
  lines.push(`const merged = ${groups[0]};`);
} else {
  lines.push(`const merged = mergeJobTypeRegistries(${groups.join(", ")});`);
}

lines.push(`type MergedDefs = JobTypeRegistryDefinitions<typeof merged>;`);
lines.push(``);

// Type assertions to exercise ChainReachMap
lines.push(`// Exercise ChainTypesReaching (triggers ChainReachMap) on a sample of types`);
lines.push(
  `// If __slice short-circuit works, this should typecheck quickly even with ${SLICES * TYPES_PER_SLICE} types`,
);

// Sample a few slices to check
const sampleSlices = [
  0,
  Math.floor(SLICES / 4),
  Math.floor(SLICES / 2),
  Math.floor((3 * SLICES) / 4),
  SLICES - 1,
];
for (const s of sampleSlices) {
  const entry = `s${s}-t0`;
  const mid = `s${s}-t${Math.floor(TYPES_PER_SLICE / 2)}`;
  const last = `s${s}-t${TYPES_PER_SLICE - 1}`;

  lines.push(``);
  lines.push(`// Slice ${s}: entry reaches itself`);
  lines.push(
    `expectTypeOf<ChainTypesReaching<MergedDefs, "${entry}">>().toEqualTypeOf<"${entry}">();`,
  );
  lines.push(`// Slice ${s}: mid-chain type reached by its entry`);
  lines.push(
    `expectTypeOf<ChainTypesReaching<MergedDefs, "${mid}">>().toEqualTypeOf<"${entry}">();`,
  );
  lines.push(`// Slice ${s}: terminal type reached by its entry`);
  lines.push(
    `expectTypeOf<ChainTypesReaching<MergedDefs, "${last}">>().toEqualTypeOf<"${entry}">();`,
  );
}

lines.push(``);
lines.push(`// Verify ChainJobTypeNames collects exactly the slice's types`);
const chainSlice = 0;
const chainTypes = [];
for (let t = 0; t < TYPES_PER_SLICE; t++) {
  chainTypes.push(`"s${chainSlice}-t${t}"`);
}
lines.push(
  `expectTypeOf<ChainJobTypeNames<MergedDefs, "s${chainSlice}-t0">>().toEqualTypeOf<${chainTypes.join(" | ")}>();`,
);

lines.push(``);
lines.push(`// Verify EntryJobTypeDefinitions sees all ${SLICES} entries`);
const entryKeys = [];
for (let s = 0; s < SLICES; s++) {
  entryKeys.push(`"s${s}-t0"`);
}
lines.push(
  `expectTypeOf<keyof EntryJobTypeDefinitions<MergedDefs>>().toEqualTypeOf<${entryKeys.join(" | ")}>();`,
);

lines.push(``);

process.stdout.write(lines.join("\n"));
