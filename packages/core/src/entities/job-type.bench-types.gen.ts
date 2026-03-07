/**
 * Auto-generated benchmark: 100 slices × 20 types = 2000 total.
 * Validates that slice-aware ChainReachMap completes typecheck in reasonable time.
 *
 * Regenerate: node packages/core/src/entities/generate-bench-types.mjs 100 20
 */
import { expectTypeOf } from "vitest";
import { type JobTypeRegistryDefinitions } from "./job-type-registry.js";
import {
  type ChainJobTypeNames,
  type ChainTypesReaching,
  type EntryJobTypeDefinitions,
  defineJobTypes,
} from "./job-type.js";
import { mergeJobTypeRegistries } from "./merge-job-type-registries.js";

const slice0 = defineJobTypes<{
  "s0-t0": { entry: true; input: { s: 0; t: 0 }; continueWith: { typeName: "s0-t1" } };
  "s0-t1": { input: { s: 0; t: 1 }; continueWith: { typeName: "s0-t2" } };
  "s0-t2": { input: { s: 0; t: 2 }; continueWith: { typeName: "s0-t3" } };
  "s0-t3": { input: { s: 0; t: 3 }; continueWith: { typeName: "s0-t4" } };
  "s0-t4": { input: { s: 0; t: 4 }; continueWith: { typeName: "s0-t5" } };
  "s0-t5": { input: { s: 0; t: 5 }; continueWith: { typeName: "s0-t6" } };
  "s0-t6": { input: { s: 0; t: 6 }; continueWith: { typeName: "s0-t7" } };
  "s0-t7": { input: { s: 0; t: 7 }; continueWith: { typeName: "s0-t8" } };
  "s0-t8": { input: { s: 0; t: 8 }; continueWith: { typeName: "s0-t9" } };
  "s0-t9": { input: { s: 0; t: 9 }; continueWith: { typeName: "s0-t10" } };
  "s0-t10": { input: { s: 0; t: 10 }; continueWith: { typeName: "s0-t11" } };
  "s0-t11": { input: { s: 0; t: 11 }; continueWith: { typeName: "s0-t12" } };
  "s0-t12": { input: { s: 0; t: 12 }; continueWith: { typeName: "s0-t13" } };
  "s0-t13": { input: { s: 0; t: 13 }; continueWith: { typeName: "s0-t14" } };
  "s0-t14": { input: { s: 0; t: 14 }; continueWith: { typeName: "s0-t15" } };
  "s0-t15": { input: { s: 0; t: 15 }; continueWith: { typeName: "s0-t16" } };
  "s0-t16": { input: { s: 0; t: 16 }; continueWith: { typeName: "s0-t17" } };
  "s0-t17": { input: { s: 0; t: 17 }; continueWith: { typeName: "s0-t18" } };
  "s0-t18": { input: { s: 0; t: 18 }; continueWith: { typeName: "s0-t19" } };
  "s0-t19": { input: { s: 0; t: 19 }; output: { s: 0; done: true } };
}>();

const slice1 = defineJobTypes<{
  "s1-t0": { entry: true; input: { s: 1; t: 0 }; continueWith: { typeName: "s1-t1" } };
  "s1-t1": { input: { s: 1; t: 1 }; continueWith: { typeName: "s1-t2" } };
  "s1-t2": { input: { s: 1; t: 2 }; continueWith: { typeName: "s1-t3" } };
  "s1-t3": { input: { s: 1; t: 3 }; continueWith: { typeName: "s1-t4" } };
  "s1-t4": { input: { s: 1; t: 4 }; continueWith: { typeName: "s1-t5" } };
  "s1-t5": { input: { s: 1; t: 5 }; continueWith: { typeName: "s1-t6" } };
  "s1-t6": { input: { s: 1; t: 6 }; continueWith: { typeName: "s1-t7" } };
  "s1-t7": { input: { s: 1; t: 7 }; continueWith: { typeName: "s1-t8" } };
  "s1-t8": { input: { s: 1; t: 8 }; continueWith: { typeName: "s1-t9" } };
  "s1-t9": { input: { s: 1; t: 9 }; continueWith: { typeName: "s1-t10" } };
  "s1-t10": { input: { s: 1; t: 10 }; continueWith: { typeName: "s1-t11" } };
  "s1-t11": { input: { s: 1; t: 11 }; continueWith: { typeName: "s1-t12" } };
  "s1-t12": { input: { s: 1; t: 12 }; continueWith: { typeName: "s1-t13" } };
  "s1-t13": { input: { s: 1; t: 13 }; continueWith: { typeName: "s1-t14" } };
  "s1-t14": { input: { s: 1; t: 14 }; continueWith: { typeName: "s1-t15" } };
  "s1-t15": { input: { s: 1; t: 15 }; continueWith: { typeName: "s1-t16" } };
  "s1-t16": { input: { s: 1; t: 16 }; continueWith: { typeName: "s1-t17" } };
  "s1-t17": { input: { s: 1; t: 17 }; continueWith: { typeName: "s1-t18" } };
  "s1-t18": { input: { s: 1; t: 18 }; continueWith: { typeName: "s1-t19" } };
  "s1-t19": { input: { s: 1; t: 19 }; output: { s: 1; done: true } };
}>();

const slice2 = defineJobTypes<{
  "s2-t0": { entry: true; input: { s: 2; t: 0 }; continueWith: { typeName: "s2-t1" } };
  "s2-t1": { input: { s: 2; t: 1 }; continueWith: { typeName: "s2-t2" } };
  "s2-t2": { input: { s: 2; t: 2 }; continueWith: { typeName: "s2-t3" } };
  "s2-t3": { input: { s: 2; t: 3 }; continueWith: { typeName: "s2-t4" } };
  "s2-t4": { input: { s: 2; t: 4 }; continueWith: { typeName: "s2-t5" } };
  "s2-t5": { input: { s: 2; t: 5 }; continueWith: { typeName: "s2-t6" } };
  "s2-t6": { input: { s: 2; t: 6 }; continueWith: { typeName: "s2-t7" } };
  "s2-t7": { input: { s: 2; t: 7 }; continueWith: { typeName: "s2-t8" } };
  "s2-t8": { input: { s: 2; t: 8 }; continueWith: { typeName: "s2-t9" } };
  "s2-t9": { input: { s: 2; t: 9 }; continueWith: { typeName: "s2-t10" } };
  "s2-t10": { input: { s: 2; t: 10 }; continueWith: { typeName: "s2-t11" } };
  "s2-t11": { input: { s: 2; t: 11 }; continueWith: { typeName: "s2-t12" } };
  "s2-t12": { input: { s: 2; t: 12 }; continueWith: { typeName: "s2-t13" } };
  "s2-t13": { input: { s: 2; t: 13 }; continueWith: { typeName: "s2-t14" } };
  "s2-t14": { input: { s: 2; t: 14 }; continueWith: { typeName: "s2-t15" } };
  "s2-t15": { input: { s: 2; t: 15 }; continueWith: { typeName: "s2-t16" } };
  "s2-t16": { input: { s: 2; t: 16 }; continueWith: { typeName: "s2-t17" } };
  "s2-t17": { input: { s: 2; t: 17 }; continueWith: { typeName: "s2-t18" } };
  "s2-t18": { input: { s: 2; t: 18 }; continueWith: { typeName: "s2-t19" } };
  "s2-t19": { input: { s: 2; t: 19 }; output: { s: 2; done: true } };
}>();

const slice3 = defineJobTypes<{
  "s3-t0": { entry: true; input: { s: 3; t: 0 }; continueWith: { typeName: "s3-t1" } };
  "s3-t1": { input: { s: 3; t: 1 }; continueWith: { typeName: "s3-t2" } };
  "s3-t2": { input: { s: 3; t: 2 }; continueWith: { typeName: "s3-t3" } };
  "s3-t3": { input: { s: 3; t: 3 }; continueWith: { typeName: "s3-t4" } };
  "s3-t4": { input: { s: 3; t: 4 }; continueWith: { typeName: "s3-t5" } };
  "s3-t5": { input: { s: 3; t: 5 }; continueWith: { typeName: "s3-t6" } };
  "s3-t6": { input: { s: 3; t: 6 }; continueWith: { typeName: "s3-t7" } };
  "s3-t7": { input: { s: 3; t: 7 }; continueWith: { typeName: "s3-t8" } };
  "s3-t8": { input: { s: 3; t: 8 }; continueWith: { typeName: "s3-t9" } };
  "s3-t9": { input: { s: 3; t: 9 }; continueWith: { typeName: "s3-t10" } };
  "s3-t10": { input: { s: 3; t: 10 }; continueWith: { typeName: "s3-t11" } };
  "s3-t11": { input: { s: 3; t: 11 }; continueWith: { typeName: "s3-t12" } };
  "s3-t12": { input: { s: 3; t: 12 }; continueWith: { typeName: "s3-t13" } };
  "s3-t13": { input: { s: 3; t: 13 }; continueWith: { typeName: "s3-t14" } };
  "s3-t14": { input: { s: 3; t: 14 }; continueWith: { typeName: "s3-t15" } };
  "s3-t15": { input: { s: 3; t: 15 }; continueWith: { typeName: "s3-t16" } };
  "s3-t16": { input: { s: 3; t: 16 }; continueWith: { typeName: "s3-t17" } };
  "s3-t17": { input: { s: 3; t: 17 }; continueWith: { typeName: "s3-t18" } };
  "s3-t18": { input: { s: 3; t: 18 }; continueWith: { typeName: "s3-t19" } };
  "s3-t19": { input: { s: 3; t: 19 }; output: { s: 3; done: true } };
}>();

const slice4 = defineJobTypes<{
  "s4-t0": { entry: true; input: { s: 4; t: 0 }; continueWith: { typeName: "s4-t1" } };
  "s4-t1": { input: { s: 4; t: 1 }; continueWith: { typeName: "s4-t2" } };
  "s4-t2": { input: { s: 4; t: 2 }; continueWith: { typeName: "s4-t3" } };
  "s4-t3": { input: { s: 4; t: 3 }; continueWith: { typeName: "s4-t4" } };
  "s4-t4": { input: { s: 4; t: 4 }; continueWith: { typeName: "s4-t5" } };
  "s4-t5": { input: { s: 4; t: 5 }; continueWith: { typeName: "s4-t6" } };
  "s4-t6": { input: { s: 4; t: 6 }; continueWith: { typeName: "s4-t7" } };
  "s4-t7": { input: { s: 4; t: 7 }; continueWith: { typeName: "s4-t8" } };
  "s4-t8": { input: { s: 4; t: 8 }; continueWith: { typeName: "s4-t9" } };
  "s4-t9": { input: { s: 4; t: 9 }; continueWith: { typeName: "s4-t10" } };
  "s4-t10": { input: { s: 4; t: 10 }; continueWith: { typeName: "s4-t11" } };
  "s4-t11": { input: { s: 4; t: 11 }; continueWith: { typeName: "s4-t12" } };
  "s4-t12": { input: { s: 4; t: 12 }; continueWith: { typeName: "s4-t13" } };
  "s4-t13": { input: { s: 4; t: 13 }; continueWith: { typeName: "s4-t14" } };
  "s4-t14": { input: { s: 4; t: 14 }; continueWith: { typeName: "s4-t15" } };
  "s4-t15": { input: { s: 4; t: 15 }; continueWith: { typeName: "s4-t16" } };
  "s4-t16": { input: { s: 4; t: 16 }; continueWith: { typeName: "s4-t17" } };
  "s4-t17": { input: { s: 4; t: 17 }; continueWith: { typeName: "s4-t18" } };
  "s4-t18": { input: { s: 4; t: 18 }; continueWith: { typeName: "s4-t19" } };
  "s4-t19": { input: { s: 4; t: 19 }; output: { s: 4; done: true } };
}>();

const slice5 = defineJobTypes<{
  "s5-t0": { entry: true; input: { s: 5; t: 0 }; continueWith: { typeName: "s5-t1" } };
  "s5-t1": { input: { s: 5; t: 1 }; continueWith: { typeName: "s5-t2" } };
  "s5-t2": { input: { s: 5; t: 2 }; continueWith: { typeName: "s5-t3" } };
  "s5-t3": { input: { s: 5; t: 3 }; continueWith: { typeName: "s5-t4" } };
  "s5-t4": { input: { s: 5; t: 4 }; continueWith: { typeName: "s5-t5" } };
  "s5-t5": { input: { s: 5; t: 5 }; continueWith: { typeName: "s5-t6" } };
  "s5-t6": { input: { s: 5; t: 6 }; continueWith: { typeName: "s5-t7" } };
  "s5-t7": { input: { s: 5; t: 7 }; continueWith: { typeName: "s5-t8" } };
  "s5-t8": { input: { s: 5; t: 8 }; continueWith: { typeName: "s5-t9" } };
  "s5-t9": { input: { s: 5; t: 9 }; continueWith: { typeName: "s5-t10" } };
  "s5-t10": { input: { s: 5; t: 10 }; continueWith: { typeName: "s5-t11" } };
  "s5-t11": { input: { s: 5; t: 11 }; continueWith: { typeName: "s5-t12" } };
  "s5-t12": { input: { s: 5; t: 12 }; continueWith: { typeName: "s5-t13" } };
  "s5-t13": { input: { s: 5; t: 13 }; continueWith: { typeName: "s5-t14" } };
  "s5-t14": { input: { s: 5; t: 14 }; continueWith: { typeName: "s5-t15" } };
  "s5-t15": { input: { s: 5; t: 15 }; continueWith: { typeName: "s5-t16" } };
  "s5-t16": { input: { s: 5; t: 16 }; continueWith: { typeName: "s5-t17" } };
  "s5-t17": { input: { s: 5; t: 17 }; continueWith: { typeName: "s5-t18" } };
  "s5-t18": { input: { s: 5; t: 18 }; continueWith: { typeName: "s5-t19" } };
  "s5-t19": { input: { s: 5; t: 19 }; output: { s: 5; done: true } };
}>();

const slice6 = defineJobTypes<{
  "s6-t0": { entry: true; input: { s: 6; t: 0 }; continueWith: { typeName: "s6-t1" } };
  "s6-t1": { input: { s: 6; t: 1 }; continueWith: { typeName: "s6-t2" } };
  "s6-t2": { input: { s: 6; t: 2 }; continueWith: { typeName: "s6-t3" } };
  "s6-t3": { input: { s: 6; t: 3 }; continueWith: { typeName: "s6-t4" } };
  "s6-t4": { input: { s: 6; t: 4 }; continueWith: { typeName: "s6-t5" } };
  "s6-t5": { input: { s: 6; t: 5 }; continueWith: { typeName: "s6-t6" } };
  "s6-t6": { input: { s: 6; t: 6 }; continueWith: { typeName: "s6-t7" } };
  "s6-t7": { input: { s: 6; t: 7 }; continueWith: { typeName: "s6-t8" } };
  "s6-t8": { input: { s: 6; t: 8 }; continueWith: { typeName: "s6-t9" } };
  "s6-t9": { input: { s: 6; t: 9 }; continueWith: { typeName: "s6-t10" } };
  "s6-t10": { input: { s: 6; t: 10 }; continueWith: { typeName: "s6-t11" } };
  "s6-t11": { input: { s: 6; t: 11 }; continueWith: { typeName: "s6-t12" } };
  "s6-t12": { input: { s: 6; t: 12 }; continueWith: { typeName: "s6-t13" } };
  "s6-t13": { input: { s: 6; t: 13 }; continueWith: { typeName: "s6-t14" } };
  "s6-t14": { input: { s: 6; t: 14 }; continueWith: { typeName: "s6-t15" } };
  "s6-t15": { input: { s: 6; t: 15 }; continueWith: { typeName: "s6-t16" } };
  "s6-t16": { input: { s: 6; t: 16 }; continueWith: { typeName: "s6-t17" } };
  "s6-t17": { input: { s: 6; t: 17 }; continueWith: { typeName: "s6-t18" } };
  "s6-t18": { input: { s: 6; t: 18 }; continueWith: { typeName: "s6-t19" } };
  "s6-t19": { input: { s: 6; t: 19 }; output: { s: 6; done: true } };
}>();

const slice7 = defineJobTypes<{
  "s7-t0": { entry: true; input: { s: 7; t: 0 }; continueWith: { typeName: "s7-t1" } };
  "s7-t1": { input: { s: 7; t: 1 }; continueWith: { typeName: "s7-t2" } };
  "s7-t2": { input: { s: 7; t: 2 }; continueWith: { typeName: "s7-t3" } };
  "s7-t3": { input: { s: 7; t: 3 }; continueWith: { typeName: "s7-t4" } };
  "s7-t4": { input: { s: 7; t: 4 }; continueWith: { typeName: "s7-t5" } };
  "s7-t5": { input: { s: 7; t: 5 }; continueWith: { typeName: "s7-t6" } };
  "s7-t6": { input: { s: 7; t: 6 }; continueWith: { typeName: "s7-t7" } };
  "s7-t7": { input: { s: 7; t: 7 }; continueWith: { typeName: "s7-t8" } };
  "s7-t8": { input: { s: 7; t: 8 }; continueWith: { typeName: "s7-t9" } };
  "s7-t9": { input: { s: 7; t: 9 }; continueWith: { typeName: "s7-t10" } };
  "s7-t10": { input: { s: 7; t: 10 }; continueWith: { typeName: "s7-t11" } };
  "s7-t11": { input: { s: 7; t: 11 }; continueWith: { typeName: "s7-t12" } };
  "s7-t12": { input: { s: 7; t: 12 }; continueWith: { typeName: "s7-t13" } };
  "s7-t13": { input: { s: 7; t: 13 }; continueWith: { typeName: "s7-t14" } };
  "s7-t14": { input: { s: 7; t: 14 }; continueWith: { typeName: "s7-t15" } };
  "s7-t15": { input: { s: 7; t: 15 }; continueWith: { typeName: "s7-t16" } };
  "s7-t16": { input: { s: 7; t: 16 }; continueWith: { typeName: "s7-t17" } };
  "s7-t17": { input: { s: 7; t: 17 }; continueWith: { typeName: "s7-t18" } };
  "s7-t18": { input: { s: 7; t: 18 }; continueWith: { typeName: "s7-t19" } };
  "s7-t19": { input: { s: 7; t: 19 }; output: { s: 7; done: true } };
}>();

const slice8 = defineJobTypes<{
  "s8-t0": { entry: true; input: { s: 8; t: 0 }; continueWith: { typeName: "s8-t1" } };
  "s8-t1": { input: { s: 8; t: 1 }; continueWith: { typeName: "s8-t2" } };
  "s8-t2": { input: { s: 8; t: 2 }; continueWith: { typeName: "s8-t3" } };
  "s8-t3": { input: { s: 8; t: 3 }; continueWith: { typeName: "s8-t4" } };
  "s8-t4": { input: { s: 8; t: 4 }; continueWith: { typeName: "s8-t5" } };
  "s8-t5": { input: { s: 8; t: 5 }; continueWith: { typeName: "s8-t6" } };
  "s8-t6": { input: { s: 8; t: 6 }; continueWith: { typeName: "s8-t7" } };
  "s8-t7": { input: { s: 8; t: 7 }; continueWith: { typeName: "s8-t8" } };
  "s8-t8": { input: { s: 8; t: 8 }; continueWith: { typeName: "s8-t9" } };
  "s8-t9": { input: { s: 8; t: 9 }; continueWith: { typeName: "s8-t10" } };
  "s8-t10": { input: { s: 8; t: 10 }; continueWith: { typeName: "s8-t11" } };
  "s8-t11": { input: { s: 8; t: 11 }; continueWith: { typeName: "s8-t12" } };
  "s8-t12": { input: { s: 8; t: 12 }; continueWith: { typeName: "s8-t13" } };
  "s8-t13": { input: { s: 8; t: 13 }; continueWith: { typeName: "s8-t14" } };
  "s8-t14": { input: { s: 8; t: 14 }; continueWith: { typeName: "s8-t15" } };
  "s8-t15": { input: { s: 8; t: 15 }; continueWith: { typeName: "s8-t16" } };
  "s8-t16": { input: { s: 8; t: 16 }; continueWith: { typeName: "s8-t17" } };
  "s8-t17": { input: { s: 8; t: 17 }; continueWith: { typeName: "s8-t18" } };
  "s8-t18": { input: { s: 8; t: 18 }; continueWith: { typeName: "s8-t19" } };
  "s8-t19": { input: { s: 8; t: 19 }; output: { s: 8; done: true } };
}>();

const slice9 = defineJobTypes<{
  "s9-t0": { entry: true; input: { s: 9; t: 0 }; continueWith: { typeName: "s9-t1" } };
  "s9-t1": { input: { s: 9; t: 1 }; continueWith: { typeName: "s9-t2" } };
  "s9-t2": { input: { s: 9; t: 2 }; continueWith: { typeName: "s9-t3" } };
  "s9-t3": { input: { s: 9; t: 3 }; continueWith: { typeName: "s9-t4" } };
  "s9-t4": { input: { s: 9; t: 4 }; continueWith: { typeName: "s9-t5" } };
  "s9-t5": { input: { s: 9; t: 5 }; continueWith: { typeName: "s9-t6" } };
  "s9-t6": { input: { s: 9; t: 6 }; continueWith: { typeName: "s9-t7" } };
  "s9-t7": { input: { s: 9; t: 7 }; continueWith: { typeName: "s9-t8" } };
  "s9-t8": { input: { s: 9; t: 8 }; continueWith: { typeName: "s9-t9" } };
  "s9-t9": { input: { s: 9; t: 9 }; continueWith: { typeName: "s9-t10" } };
  "s9-t10": { input: { s: 9; t: 10 }; continueWith: { typeName: "s9-t11" } };
  "s9-t11": { input: { s: 9; t: 11 }; continueWith: { typeName: "s9-t12" } };
  "s9-t12": { input: { s: 9; t: 12 }; continueWith: { typeName: "s9-t13" } };
  "s9-t13": { input: { s: 9; t: 13 }; continueWith: { typeName: "s9-t14" } };
  "s9-t14": { input: { s: 9; t: 14 }; continueWith: { typeName: "s9-t15" } };
  "s9-t15": { input: { s: 9; t: 15 }; continueWith: { typeName: "s9-t16" } };
  "s9-t16": { input: { s: 9; t: 16 }; continueWith: { typeName: "s9-t17" } };
  "s9-t17": { input: { s: 9; t: 17 }; continueWith: { typeName: "s9-t18" } };
  "s9-t18": { input: { s: 9; t: 18 }; continueWith: { typeName: "s9-t19" } };
  "s9-t19": { input: { s: 9; t: 19 }; output: { s: 9; done: true } };
}>();

const slice10 = defineJobTypes<{
  "s10-t0": { entry: true; input: { s: 10; t: 0 }; continueWith: { typeName: "s10-t1" } };
  "s10-t1": { input: { s: 10; t: 1 }; continueWith: { typeName: "s10-t2" } };
  "s10-t2": { input: { s: 10; t: 2 }; continueWith: { typeName: "s10-t3" } };
  "s10-t3": { input: { s: 10; t: 3 }; continueWith: { typeName: "s10-t4" } };
  "s10-t4": { input: { s: 10; t: 4 }; continueWith: { typeName: "s10-t5" } };
  "s10-t5": { input: { s: 10; t: 5 }; continueWith: { typeName: "s10-t6" } };
  "s10-t6": { input: { s: 10; t: 6 }; continueWith: { typeName: "s10-t7" } };
  "s10-t7": { input: { s: 10; t: 7 }; continueWith: { typeName: "s10-t8" } };
  "s10-t8": { input: { s: 10; t: 8 }; continueWith: { typeName: "s10-t9" } };
  "s10-t9": { input: { s: 10; t: 9 }; continueWith: { typeName: "s10-t10" } };
  "s10-t10": { input: { s: 10; t: 10 }; continueWith: { typeName: "s10-t11" } };
  "s10-t11": { input: { s: 10; t: 11 }; continueWith: { typeName: "s10-t12" } };
  "s10-t12": { input: { s: 10; t: 12 }; continueWith: { typeName: "s10-t13" } };
  "s10-t13": { input: { s: 10; t: 13 }; continueWith: { typeName: "s10-t14" } };
  "s10-t14": { input: { s: 10; t: 14 }; continueWith: { typeName: "s10-t15" } };
  "s10-t15": { input: { s: 10; t: 15 }; continueWith: { typeName: "s10-t16" } };
  "s10-t16": { input: { s: 10; t: 16 }; continueWith: { typeName: "s10-t17" } };
  "s10-t17": { input: { s: 10; t: 17 }; continueWith: { typeName: "s10-t18" } };
  "s10-t18": { input: { s: 10; t: 18 }; continueWith: { typeName: "s10-t19" } };
  "s10-t19": { input: { s: 10; t: 19 }; output: { s: 10; done: true } };
}>();

const slice11 = defineJobTypes<{
  "s11-t0": { entry: true; input: { s: 11; t: 0 }; continueWith: { typeName: "s11-t1" } };
  "s11-t1": { input: { s: 11; t: 1 }; continueWith: { typeName: "s11-t2" } };
  "s11-t2": { input: { s: 11; t: 2 }; continueWith: { typeName: "s11-t3" } };
  "s11-t3": { input: { s: 11; t: 3 }; continueWith: { typeName: "s11-t4" } };
  "s11-t4": { input: { s: 11; t: 4 }; continueWith: { typeName: "s11-t5" } };
  "s11-t5": { input: { s: 11; t: 5 }; continueWith: { typeName: "s11-t6" } };
  "s11-t6": { input: { s: 11; t: 6 }; continueWith: { typeName: "s11-t7" } };
  "s11-t7": { input: { s: 11; t: 7 }; continueWith: { typeName: "s11-t8" } };
  "s11-t8": { input: { s: 11; t: 8 }; continueWith: { typeName: "s11-t9" } };
  "s11-t9": { input: { s: 11; t: 9 }; continueWith: { typeName: "s11-t10" } };
  "s11-t10": { input: { s: 11; t: 10 }; continueWith: { typeName: "s11-t11" } };
  "s11-t11": { input: { s: 11; t: 11 }; continueWith: { typeName: "s11-t12" } };
  "s11-t12": { input: { s: 11; t: 12 }; continueWith: { typeName: "s11-t13" } };
  "s11-t13": { input: { s: 11; t: 13 }; continueWith: { typeName: "s11-t14" } };
  "s11-t14": { input: { s: 11; t: 14 }; continueWith: { typeName: "s11-t15" } };
  "s11-t15": { input: { s: 11; t: 15 }; continueWith: { typeName: "s11-t16" } };
  "s11-t16": { input: { s: 11; t: 16 }; continueWith: { typeName: "s11-t17" } };
  "s11-t17": { input: { s: 11; t: 17 }; continueWith: { typeName: "s11-t18" } };
  "s11-t18": { input: { s: 11; t: 18 }; continueWith: { typeName: "s11-t19" } };
  "s11-t19": { input: { s: 11; t: 19 }; output: { s: 11; done: true } };
}>();

const slice12 = defineJobTypes<{
  "s12-t0": { entry: true; input: { s: 12; t: 0 }; continueWith: { typeName: "s12-t1" } };
  "s12-t1": { input: { s: 12; t: 1 }; continueWith: { typeName: "s12-t2" } };
  "s12-t2": { input: { s: 12; t: 2 }; continueWith: { typeName: "s12-t3" } };
  "s12-t3": { input: { s: 12; t: 3 }; continueWith: { typeName: "s12-t4" } };
  "s12-t4": { input: { s: 12; t: 4 }; continueWith: { typeName: "s12-t5" } };
  "s12-t5": { input: { s: 12; t: 5 }; continueWith: { typeName: "s12-t6" } };
  "s12-t6": { input: { s: 12; t: 6 }; continueWith: { typeName: "s12-t7" } };
  "s12-t7": { input: { s: 12; t: 7 }; continueWith: { typeName: "s12-t8" } };
  "s12-t8": { input: { s: 12; t: 8 }; continueWith: { typeName: "s12-t9" } };
  "s12-t9": { input: { s: 12; t: 9 }; continueWith: { typeName: "s12-t10" } };
  "s12-t10": { input: { s: 12; t: 10 }; continueWith: { typeName: "s12-t11" } };
  "s12-t11": { input: { s: 12; t: 11 }; continueWith: { typeName: "s12-t12" } };
  "s12-t12": { input: { s: 12; t: 12 }; continueWith: { typeName: "s12-t13" } };
  "s12-t13": { input: { s: 12; t: 13 }; continueWith: { typeName: "s12-t14" } };
  "s12-t14": { input: { s: 12; t: 14 }; continueWith: { typeName: "s12-t15" } };
  "s12-t15": { input: { s: 12; t: 15 }; continueWith: { typeName: "s12-t16" } };
  "s12-t16": { input: { s: 12; t: 16 }; continueWith: { typeName: "s12-t17" } };
  "s12-t17": { input: { s: 12; t: 17 }; continueWith: { typeName: "s12-t18" } };
  "s12-t18": { input: { s: 12; t: 18 }; continueWith: { typeName: "s12-t19" } };
  "s12-t19": { input: { s: 12; t: 19 }; output: { s: 12; done: true } };
}>();

const slice13 = defineJobTypes<{
  "s13-t0": { entry: true; input: { s: 13; t: 0 }; continueWith: { typeName: "s13-t1" } };
  "s13-t1": { input: { s: 13; t: 1 }; continueWith: { typeName: "s13-t2" } };
  "s13-t2": { input: { s: 13; t: 2 }; continueWith: { typeName: "s13-t3" } };
  "s13-t3": { input: { s: 13; t: 3 }; continueWith: { typeName: "s13-t4" } };
  "s13-t4": { input: { s: 13; t: 4 }; continueWith: { typeName: "s13-t5" } };
  "s13-t5": { input: { s: 13; t: 5 }; continueWith: { typeName: "s13-t6" } };
  "s13-t6": { input: { s: 13; t: 6 }; continueWith: { typeName: "s13-t7" } };
  "s13-t7": { input: { s: 13; t: 7 }; continueWith: { typeName: "s13-t8" } };
  "s13-t8": { input: { s: 13; t: 8 }; continueWith: { typeName: "s13-t9" } };
  "s13-t9": { input: { s: 13; t: 9 }; continueWith: { typeName: "s13-t10" } };
  "s13-t10": { input: { s: 13; t: 10 }; continueWith: { typeName: "s13-t11" } };
  "s13-t11": { input: { s: 13; t: 11 }; continueWith: { typeName: "s13-t12" } };
  "s13-t12": { input: { s: 13; t: 12 }; continueWith: { typeName: "s13-t13" } };
  "s13-t13": { input: { s: 13; t: 13 }; continueWith: { typeName: "s13-t14" } };
  "s13-t14": { input: { s: 13; t: 14 }; continueWith: { typeName: "s13-t15" } };
  "s13-t15": { input: { s: 13; t: 15 }; continueWith: { typeName: "s13-t16" } };
  "s13-t16": { input: { s: 13; t: 16 }; continueWith: { typeName: "s13-t17" } };
  "s13-t17": { input: { s: 13; t: 17 }; continueWith: { typeName: "s13-t18" } };
  "s13-t18": { input: { s: 13; t: 18 }; continueWith: { typeName: "s13-t19" } };
  "s13-t19": { input: { s: 13; t: 19 }; output: { s: 13; done: true } };
}>();

const slice14 = defineJobTypes<{
  "s14-t0": { entry: true; input: { s: 14; t: 0 }; continueWith: { typeName: "s14-t1" } };
  "s14-t1": { input: { s: 14; t: 1 }; continueWith: { typeName: "s14-t2" } };
  "s14-t2": { input: { s: 14; t: 2 }; continueWith: { typeName: "s14-t3" } };
  "s14-t3": { input: { s: 14; t: 3 }; continueWith: { typeName: "s14-t4" } };
  "s14-t4": { input: { s: 14; t: 4 }; continueWith: { typeName: "s14-t5" } };
  "s14-t5": { input: { s: 14; t: 5 }; continueWith: { typeName: "s14-t6" } };
  "s14-t6": { input: { s: 14; t: 6 }; continueWith: { typeName: "s14-t7" } };
  "s14-t7": { input: { s: 14; t: 7 }; continueWith: { typeName: "s14-t8" } };
  "s14-t8": { input: { s: 14; t: 8 }; continueWith: { typeName: "s14-t9" } };
  "s14-t9": { input: { s: 14; t: 9 }; continueWith: { typeName: "s14-t10" } };
  "s14-t10": { input: { s: 14; t: 10 }; continueWith: { typeName: "s14-t11" } };
  "s14-t11": { input: { s: 14; t: 11 }; continueWith: { typeName: "s14-t12" } };
  "s14-t12": { input: { s: 14; t: 12 }; continueWith: { typeName: "s14-t13" } };
  "s14-t13": { input: { s: 14; t: 13 }; continueWith: { typeName: "s14-t14" } };
  "s14-t14": { input: { s: 14; t: 14 }; continueWith: { typeName: "s14-t15" } };
  "s14-t15": { input: { s: 14; t: 15 }; continueWith: { typeName: "s14-t16" } };
  "s14-t16": { input: { s: 14; t: 16 }; continueWith: { typeName: "s14-t17" } };
  "s14-t17": { input: { s: 14; t: 17 }; continueWith: { typeName: "s14-t18" } };
  "s14-t18": { input: { s: 14; t: 18 }; continueWith: { typeName: "s14-t19" } };
  "s14-t19": { input: { s: 14; t: 19 }; output: { s: 14; done: true } };
}>();

const slice15 = defineJobTypes<{
  "s15-t0": { entry: true; input: { s: 15; t: 0 }; continueWith: { typeName: "s15-t1" } };
  "s15-t1": { input: { s: 15; t: 1 }; continueWith: { typeName: "s15-t2" } };
  "s15-t2": { input: { s: 15; t: 2 }; continueWith: { typeName: "s15-t3" } };
  "s15-t3": { input: { s: 15; t: 3 }; continueWith: { typeName: "s15-t4" } };
  "s15-t4": { input: { s: 15; t: 4 }; continueWith: { typeName: "s15-t5" } };
  "s15-t5": { input: { s: 15; t: 5 }; continueWith: { typeName: "s15-t6" } };
  "s15-t6": { input: { s: 15; t: 6 }; continueWith: { typeName: "s15-t7" } };
  "s15-t7": { input: { s: 15; t: 7 }; continueWith: { typeName: "s15-t8" } };
  "s15-t8": { input: { s: 15; t: 8 }; continueWith: { typeName: "s15-t9" } };
  "s15-t9": { input: { s: 15; t: 9 }; continueWith: { typeName: "s15-t10" } };
  "s15-t10": { input: { s: 15; t: 10 }; continueWith: { typeName: "s15-t11" } };
  "s15-t11": { input: { s: 15; t: 11 }; continueWith: { typeName: "s15-t12" } };
  "s15-t12": { input: { s: 15; t: 12 }; continueWith: { typeName: "s15-t13" } };
  "s15-t13": { input: { s: 15; t: 13 }; continueWith: { typeName: "s15-t14" } };
  "s15-t14": { input: { s: 15; t: 14 }; continueWith: { typeName: "s15-t15" } };
  "s15-t15": { input: { s: 15; t: 15 }; continueWith: { typeName: "s15-t16" } };
  "s15-t16": { input: { s: 15; t: 16 }; continueWith: { typeName: "s15-t17" } };
  "s15-t17": { input: { s: 15; t: 17 }; continueWith: { typeName: "s15-t18" } };
  "s15-t18": { input: { s: 15; t: 18 }; continueWith: { typeName: "s15-t19" } };
  "s15-t19": { input: { s: 15; t: 19 }; output: { s: 15; done: true } };
}>();

const slice16 = defineJobTypes<{
  "s16-t0": { entry: true; input: { s: 16; t: 0 }; continueWith: { typeName: "s16-t1" } };
  "s16-t1": { input: { s: 16; t: 1 }; continueWith: { typeName: "s16-t2" } };
  "s16-t2": { input: { s: 16; t: 2 }; continueWith: { typeName: "s16-t3" } };
  "s16-t3": { input: { s: 16; t: 3 }; continueWith: { typeName: "s16-t4" } };
  "s16-t4": { input: { s: 16; t: 4 }; continueWith: { typeName: "s16-t5" } };
  "s16-t5": { input: { s: 16; t: 5 }; continueWith: { typeName: "s16-t6" } };
  "s16-t6": { input: { s: 16; t: 6 }; continueWith: { typeName: "s16-t7" } };
  "s16-t7": { input: { s: 16; t: 7 }; continueWith: { typeName: "s16-t8" } };
  "s16-t8": { input: { s: 16; t: 8 }; continueWith: { typeName: "s16-t9" } };
  "s16-t9": { input: { s: 16; t: 9 }; continueWith: { typeName: "s16-t10" } };
  "s16-t10": { input: { s: 16; t: 10 }; continueWith: { typeName: "s16-t11" } };
  "s16-t11": { input: { s: 16; t: 11 }; continueWith: { typeName: "s16-t12" } };
  "s16-t12": { input: { s: 16; t: 12 }; continueWith: { typeName: "s16-t13" } };
  "s16-t13": { input: { s: 16; t: 13 }; continueWith: { typeName: "s16-t14" } };
  "s16-t14": { input: { s: 16; t: 14 }; continueWith: { typeName: "s16-t15" } };
  "s16-t15": { input: { s: 16; t: 15 }; continueWith: { typeName: "s16-t16" } };
  "s16-t16": { input: { s: 16; t: 16 }; continueWith: { typeName: "s16-t17" } };
  "s16-t17": { input: { s: 16; t: 17 }; continueWith: { typeName: "s16-t18" } };
  "s16-t18": { input: { s: 16; t: 18 }; continueWith: { typeName: "s16-t19" } };
  "s16-t19": { input: { s: 16; t: 19 }; output: { s: 16; done: true } };
}>();

const slice17 = defineJobTypes<{
  "s17-t0": { entry: true; input: { s: 17; t: 0 }; continueWith: { typeName: "s17-t1" } };
  "s17-t1": { input: { s: 17; t: 1 }; continueWith: { typeName: "s17-t2" } };
  "s17-t2": { input: { s: 17; t: 2 }; continueWith: { typeName: "s17-t3" } };
  "s17-t3": { input: { s: 17; t: 3 }; continueWith: { typeName: "s17-t4" } };
  "s17-t4": { input: { s: 17; t: 4 }; continueWith: { typeName: "s17-t5" } };
  "s17-t5": { input: { s: 17; t: 5 }; continueWith: { typeName: "s17-t6" } };
  "s17-t6": { input: { s: 17; t: 6 }; continueWith: { typeName: "s17-t7" } };
  "s17-t7": { input: { s: 17; t: 7 }; continueWith: { typeName: "s17-t8" } };
  "s17-t8": { input: { s: 17; t: 8 }; continueWith: { typeName: "s17-t9" } };
  "s17-t9": { input: { s: 17; t: 9 }; continueWith: { typeName: "s17-t10" } };
  "s17-t10": { input: { s: 17; t: 10 }; continueWith: { typeName: "s17-t11" } };
  "s17-t11": { input: { s: 17; t: 11 }; continueWith: { typeName: "s17-t12" } };
  "s17-t12": { input: { s: 17; t: 12 }; continueWith: { typeName: "s17-t13" } };
  "s17-t13": { input: { s: 17; t: 13 }; continueWith: { typeName: "s17-t14" } };
  "s17-t14": { input: { s: 17; t: 14 }; continueWith: { typeName: "s17-t15" } };
  "s17-t15": { input: { s: 17; t: 15 }; continueWith: { typeName: "s17-t16" } };
  "s17-t16": { input: { s: 17; t: 16 }; continueWith: { typeName: "s17-t17" } };
  "s17-t17": { input: { s: 17; t: 17 }; continueWith: { typeName: "s17-t18" } };
  "s17-t18": { input: { s: 17; t: 18 }; continueWith: { typeName: "s17-t19" } };
  "s17-t19": { input: { s: 17; t: 19 }; output: { s: 17; done: true } };
}>();

const slice18 = defineJobTypes<{
  "s18-t0": { entry: true; input: { s: 18; t: 0 }; continueWith: { typeName: "s18-t1" } };
  "s18-t1": { input: { s: 18; t: 1 }; continueWith: { typeName: "s18-t2" } };
  "s18-t2": { input: { s: 18; t: 2 }; continueWith: { typeName: "s18-t3" } };
  "s18-t3": { input: { s: 18; t: 3 }; continueWith: { typeName: "s18-t4" } };
  "s18-t4": { input: { s: 18; t: 4 }; continueWith: { typeName: "s18-t5" } };
  "s18-t5": { input: { s: 18; t: 5 }; continueWith: { typeName: "s18-t6" } };
  "s18-t6": { input: { s: 18; t: 6 }; continueWith: { typeName: "s18-t7" } };
  "s18-t7": { input: { s: 18; t: 7 }; continueWith: { typeName: "s18-t8" } };
  "s18-t8": { input: { s: 18; t: 8 }; continueWith: { typeName: "s18-t9" } };
  "s18-t9": { input: { s: 18; t: 9 }; continueWith: { typeName: "s18-t10" } };
  "s18-t10": { input: { s: 18; t: 10 }; continueWith: { typeName: "s18-t11" } };
  "s18-t11": { input: { s: 18; t: 11 }; continueWith: { typeName: "s18-t12" } };
  "s18-t12": { input: { s: 18; t: 12 }; continueWith: { typeName: "s18-t13" } };
  "s18-t13": { input: { s: 18; t: 13 }; continueWith: { typeName: "s18-t14" } };
  "s18-t14": { input: { s: 18; t: 14 }; continueWith: { typeName: "s18-t15" } };
  "s18-t15": { input: { s: 18; t: 15 }; continueWith: { typeName: "s18-t16" } };
  "s18-t16": { input: { s: 18; t: 16 }; continueWith: { typeName: "s18-t17" } };
  "s18-t17": { input: { s: 18; t: 17 }; continueWith: { typeName: "s18-t18" } };
  "s18-t18": { input: { s: 18; t: 18 }; continueWith: { typeName: "s18-t19" } };
  "s18-t19": { input: { s: 18; t: 19 }; output: { s: 18; done: true } };
}>();

const slice19 = defineJobTypes<{
  "s19-t0": { entry: true; input: { s: 19; t: 0 }; continueWith: { typeName: "s19-t1" } };
  "s19-t1": { input: { s: 19; t: 1 }; continueWith: { typeName: "s19-t2" } };
  "s19-t2": { input: { s: 19; t: 2 }; continueWith: { typeName: "s19-t3" } };
  "s19-t3": { input: { s: 19; t: 3 }; continueWith: { typeName: "s19-t4" } };
  "s19-t4": { input: { s: 19; t: 4 }; continueWith: { typeName: "s19-t5" } };
  "s19-t5": { input: { s: 19; t: 5 }; continueWith: { typeName: "s19-t6" } };
  "s19-t6": { input: { s: 19; t: 6 }; continueWith: { typeName: "s19-t7" } };
  "s19-t7": { input: { s: 19; t: 7 }; continueWith: { typeName: "s19-t8" } };
  "s19-t8": { input: { s: 19; t: 8 }; continueWith: { typeName: "s19-t9" } };
  "s19-t9": { input: { s: 19; t: 9 }; continueWith: { typeName: "s19-t10" } };
  "s19-t10": { input: { s: 19; t: 10 }; continueWith: { typeName: "s19-t11" } };
  "s19-t11": { input: { s: 19; t: 11 }; continueWith: { typeName: "s19-t12" } };
  "s19-t12": { input: { s: 19; t: 12 }; continueWith: { typeName: "s19-t13" } };
  "s19-t13": { input: { s: 19; t: 13 }; continueWith: { typeName: "s19-t14" } };
  "s19-t14": { input: { s: 19; t: 14 }; continueWith: { typeName: "s19-t15" } };
  "s19-t15": { input: { s: 19; t: 15 }; continueWith: { typeName: "s19-t16" } };
  "s19-t16": { input: { s: 19; t: 16 }; continueWith: { typeName: "s19-t17" } };
  "s19-t17": { input: { s: 19; t: 17 }; continueWith: { typeName: "s19-t18" } };
  "s19-t18": { input: { s: 19; t: 18 }; continueWith: { typeName: "s19-t19" } };
  "s19-t19": { input: { s: 19; t: 19 }; output: { s: 19; done: true } };
}>();

const slice20 = defineJobTypes<{
  "s20-t0": { entry: true; input: { s: 20; t: 0 }; continueWith: { typeName: "s20-t1" } };
  "s20-t1": { input: { s: 20; t: 1 }; continueWith: { typeName: "s20-t2" } };
  "s20-t2": { input: { s: 20; t: 2 }; continueWith: { typeName: "s20-t3" } };
  "s20-t3": { input: { s: 20; t: 3 }; continueWith: { typeName: "s20-t4" } };
  "s20-t4": { input: { s: 20; t: 4 }; continueWith: { typeName: "s20-t5" } };
  "s20-t5": { input: { s: 20; t: 5 }; continueWith: { typeName: "s20-t6" } };
  "s20-t6": { input: { s: 20; t: 6 }; continueWith: { typeName: "s20-t7" } };
  "s20-t7": { input: { s: 20; t: 7 }; continueWith: { typeName: "s20-t8" } };
  "s20-t8": { input: { s: 20; t: 8 }; continueWith: { typeName: "s20-t9" } };
  "s20-t9": { input: { s: 20; t: 9 }; continueWith: { typeName: "s20-t10" } };
  "s20-t10": { input: { s: 20; t: 10 }; continueWith: { typeName: "s20-t11" } };
  "s20-t11": { input: { s: 20; t: 11 }; continueWith: { typeName: "s20-t12" } };
  "s20-t12": { input: { s: 20; t: 12 }; continueWith: { typeName: "s20-t13" } };
  "s20-t13": { input: { s: 20; t: 13 }; continueWith: { typeName: "s20-t14" } };
  "s20-t14": { input: { s: 20; t: 14 }; continueWith: { typeName: "s20-t15" } };
  "s20-t15": { input: { s: 20; t: 15 }; continueWith: { typeName: "s20-t16" } };
  "s20-t16": { input: { s: 20; t: 16 }; continueWith: { typeName: "s20-t17" } };
  "s20-t17": { input: { s: 20; t: 17 }; continueWith: { typeName: "s20-t18" } };
  "s20-t18": { input: { s: 20; t: 18 }; continueWith: { typeName: "s20-t19" } };
  "s20-t19": { input: { s: 20; t: 19 }; output: { s: 20; done: true } };
}>();

const slice21 = defineJobTypes<{
  "s21-t0": { entry: true; input: { s: 21; t: 0 }; continueWith: { typeName: "s21-t1" } };
  "s21-t1": { input: { s: 21; t: 1 }; continueWith: { typeName: "s21-t2" } };
  "s21-t2": { input: { s: 21; t: 2 }; continueWith: { typeName: "s21-t3" } };
  "s21-t3": { input: { s: 21; t: 3 }; continueWith: { typeName: "s21-t4" } };
  "s21-t4": { input: { s: 21; t: 4 }; continueWith: { typeName: "s21-t5" } };
  "s21-t5": { input: { s: 21; t: 5 }; continueWith: { typeName: "s21-t6" } };
  "s21-t6": { input: { s: 21; t: 6 }; continueWith: { typeName: "s21-t7" } };
  "s21-t7": { input: { s: 21; t: 7 }; continueWith: { typeName: "s21-t8" } };
  "s21-t8": { input: { s: 21; t: 8 }; continueWith: { typeName: "s21-t9" } };
  "s21-t9": { input: { s: 21; t: 9 }; continueWith: { typeName: "s21-t10" } };
  "s21-t10": { input: { s: 21; t: 10 }; continueWith: { typeName: "s21-t11" } };
  "s21-t11": { input: { s: 21; t: 11 }; continueWith: { typeName: "s21-t12" } };
  "s21-t12": { input: { s: 21; t: 12 }; continueWith: { typeName: "s21-t13" } };
  "s21-t13": { input: { s: 21; t: 13 }; continueWith: { typeName: "s21-t14" } };
  "s21-t14": { input: { s: 21; t: 14 }; continueWith: { typeName: "s21-t15" } };
  "s21-t15": { input: { s: 21; t: 15 }; continueWith: { typeName: "s21-t16" } };
  "s21-t16": { input: { s: 21; t: 16 }; continueWith: { typeName: "s21-t17" } };
  "s21-t17": { input: { s: 21; t: 17 }; continueWith: { typeName: "s21-t18" } };
  "s21-t18": { input: { s: 21; t: 18 }; continueWith: { typeName: "s21-t19" } };
  "s21-t19": { input: { s: 21; t: 19 }; output: { s: 21; done: true } };
}>();

const slice22 = defineJobTypes<{
  "s22-t0": { entry: true; input: { s: 22; t: 0 }; continueWith: { typeName: "s22-t1" } };
  "s22-t1": { input: { s: 22; t: 1 }; continueWith: { typeName: "s22-t2" } };
  "s22-t2": { input: { s: 22; t: 2 }; continueWith: { typeName: "s22-t3" } };
  "s22-t3": { input: { s: 22; t: 3 }; continueWith: { typeName: "s22-t4" } };
  "s22-t4": { input: { s: 22; t: 4 }; continueWith: { typeName: "s22-t5" } };
  "s22-t5": { input: { s: 22; t: 5 }; continueWith: { typeName: "s22-t6" } };
  "s22-t6": { input: { s: 22; t: 6 }; continueWith: { typeName: "s22-t7" } };
  "s22-t7": { input: { s: 22; t: 7 }; continueWith: { typeName: "s22-t8" } };
  "s22-t8": { input: { s: 22; t: 8 }; continueWith: { typeName: "s22-t9" } };
  "s22-t9": { input: { s: 22; t: 9 }; continueWith: { typeName: "s22-t10" } };
  "s22-t10": { input: { s: 22; t: 10 }; continueWith: { typeName: "s22-t11" } };
  "s22-t11": { input: { s: 22; t: 11 }; continueWith: { typeName: "s22-t12" } };
  "s22-t12": { input: { s: 22; t: 12 }; continueWith: { typeName: "s22-t13" } };
  "s22-t13": { input: { s: 22; t: 13 }; continueWith: { typeName: "s22-t14" } };
  "s22-t14": { input: { s: 22; t: 14 }; continueWith: { typeName: "s22-t15" } };
  "s22-t15": { input: { s: 22; t: 15 }; continueWith: { typeName: "s22-t16" } };
  "s22-t16": { input: { s: 22; t: 16 }; continueWith: { typeName: "s22-t17" } };
  "s22-t17": { input: { s: 22; t: 17 }; continueWith: { typeName: "s22-t18" } };
  "s22-t18": { input: { s: 22; t: 18 }; continueWith: { typeName: "s22-t19" } };
  "s22-t19": { input: { s: 22; t: 19 }; output: { s: 22; done: true } };
}>();

const slice23 = defineJobTypes<{
  "s23-t0": { entry: true; input: { s: 23; t: 0 }; continueWith: { typeName: "s23-t1" } };
  "s23-t1": { input: { s: 23; t: 1 }; continueWith: { typeName: "s23-t2" } };
  "s23-t2": { input: { s: 23; t: 2 }; continueWith: { typeName: "s23-t3" } };
  "s23-t3": { input: { s: 23; t: 3 }; continueWith: { typeName: "s23-t4" } };
  "s23-t4": { input: { s: 23; t: 4 }; continueWith: { typeName: "s23-t5" } };
  "s23-t5": { input: { s: 23; t: 5 }; continueWith: { typeName: "s23-t6" } };
  "s23-t6": { input: { s: 23; t: 6 }; continueWith: { typeName: "s23-t7" } };
  "s23-t7": { input: { s: 23; t: 7 }; continueWith: { typeName: "s23-t8" } };
  "s23-t8": { input: { s: 23; t: 8 }; continueWith: { typeName: "s23-t9" } };
  "s23-t9": { input: { s: 23; t: 9 }; continueWith: { typeName: "s23-t10" } };
  "s23-t10": { input: { s: 23; t: 10 }; continueWith: { typeName: "s23-t11" } };
  "s23-t11": { input: { s: 23; t: 11 }; continueWith: { typeName: "s23-t12" } };
  "s23-t12": { input: { s: 23; t: 12 }; continueWith: { typeName: "s23-t13" } };
  "s23-t13": { input: { s: 23; t: 13 }; continueWith: { typeName: "s23-t14" } };
  "s23-t14": { input: { s: 23; t: 14 }; continueWith: { typeName: "s23-t15" } };
  "s23-t15": { input: { s: 23; t: 15 }; continueWith: { typeName: "s23-t16" } };
  "s23-t16": { input: { s: 23; t: 16 }; continueWith: { typeName: "s23-t17" } };
  "s23-t17": { input: { s: 23; t: 17 }; continueWith: { typeName: "s23-t18" } };
  "s23-t18": { input: { s: 23; t: 18 }; continueWith: { typeName: "s23-t19" } };
  "s23-t19": { input: { s: 23; t: 19 }; output: { s: 23; done: true } };
}>();

const slice24 = defineJobTypes<{
  "s24-t0": { entry: true; input: { s: 24; t: 0 }; continueWith: { typeName: "s24-t1" } };
  "s24-t1": { input: { s: 24; t: 1 }; continueWith: { typeName: "s24-t2" } };
  "s24-t2": { input: { s: 24; t: 2 }; continueWith: { typeName: "s24-t3" } };
  "s24-t3": { input: { s: 24; t: 3 }; continueWith: { typeName: "s24-t4" } };
  "s24-t4": { input: { s: 24; t: 4 }; continueWith: { typeName: "s24-t5" } };
  "s24-t5": { input: { s: 24; t: 5 }; continueWith: { typeName: "s24-t6" } };
  "s24-t6": { input: { s: 24; t: 6 }; continueWith: { typeName: "s24-t7" } };
  "s24-t7": { input: { s: 24; t: 7 }; continueWith: { typeName: "s24-t8" } };
  "s24-t8": { input: { s: 24; t: 8 }; continueWith: { typeName: "s24-t9" } };
  "s24-t9": { input: { s: 24; t: 9 }; continueWith: { typeName: "s24-t10" } };
  "s24-t10": { input: { s: 24; t: 10 }; continueWith: { typeName: "s24-t11" } };
  "s24-t11": { input: { s: 24; t: 11 }; continueWith: { typeName: "s24-t12" } };
  "s24-t12": { input: { s: 24; t: 12 }; continueWith: { typeName: "s24-t13" } };
  "s24-t13": { input: { s: 24; t: 13 }; continueWith: { typeName: "s24-t14" } };
  "s24-t14": { input: { s: 24; t: 14 }; continueWith: { typeName: "s24-t15" } };
  "s24-t15": { input: { s: 24; t: 15 }; continueWith: { typeName: "s24-t16" } };
  "s24-t16": { input: { s: 24; t: 16 }; continueWith: { typeName: "s24-t17" } };
  "s24-t17": { input: { s: 24; t: 17 }; continueWith: { typeName: "s24-t18" } };
  "s24-t18": { input: { s: 24; t: 18 }; continueWith: { typeName: "s24-t19" } };
  "s24-t19": { input: { s: 24; t: 19 }; output: { s: 24; done: true } };
}>();

const slice25 = defineJobTypes<{
  "s25-t0": { entry: true; input: { s: 25; t: 0 }; continueWith: { typeName: "s25-t1" } };
  "s25-t1": { input: { s: 25; t: 1 }; continueWith: { typeName: "s25-t2" } };
  "s25-t2": { input: { s: 25; t: 2 }; continueWith: { typeName: "s25-t3" } };
  "s25-t3": { input: { s: 25; t: 3 }; continueWith: { typeName: "s25-t4" } };
  "s25-t4": { input: { s: 25; t: 4 }; continueWith: { typeName: "s25-t5" } };
  "s25-t5": { input: { s: 25; t: 5 }; continueWith: { typeName: "s25-t6" } };
  "s25-t6": { input: { s: 25; t: 6 }; continueWith: { typeName: "s25-t7" } };
  "s25-t7": { input: { s: 25; t: 7 }; continueWith: { typeName: "s25-t8" } };
  "s25-t8": { input: { s: 25; t: 8 }; continueWith: { typeName: "s25-t9" } };
  "s25-t9": { input: { s: 25; t: 9 }; continueWith: { typeName: "s25-t10" } };
  "s25-t10": { input: { s: 25; t: 10 }; continueWith: { typeName: "s25-t11" } };
  "s25-t11": { input: { s: 25; t: 11 }; continueWith: { typeName: "s25-t12" } };
  "s25-t12": { input: { s: 25; t: 12 }; continueWith: { typeName: "s25-t13" } };
  "s25-t13": { input: { s: 25; t: 13 }; continueWith: { typeName: "s25-t14" } };
  "s25-t14": { input: { s: 25; t: 14 }; continueWith: { typeName: "s25-t15" } };
  "s25-t15": { input: { s: 25; t: 15 }; continueWith: { typeName: "s25-t16" } };
  "s25-t16": { input: { s: 25; t: 16 }; continueWith: { typeName: "s25-t17" } };
  "s25-t17": { input: { s: 25; t: 17 }; continueWith: { typeName: "s25-t18" } };
  "s25-t18": { input: { s: 25; t: 18 }; continueWith: { typeName: "s25-t19" } };
  "s25-t19": { input: { s: 25; t: 19 }; output: { s: 25; done: true } };
}>();

const slice26 = defineJobTypes<{
  "s26-t0": { entry: true; input: { s: 26; t: 0 }; continueWith: { typeName: "s26-t1" } };
  "s26-t1": { input: { s: 26; t: 1 }; continueWith: { typeName: "s26-t2" } };
  "s26-t2": { input: { s: 26; t: 2 }; continueWith: { typeName: "s26-t3" } };
  "s26-t3": { input: { s: 26; t: 3 }; continueWith: { typeName: "s26-t4" } };
  "s26-t4": { input: { s: 26; t: 4 }; continueWith: { typeName: "s26-t5" } };
  "s26-t5": { input: { s: 26; t: 5 }; continueWith: { typeName: "s26-t6" } };
  "s26-t6": { input: { s: 26; t: 6 }; continueWith: { typeName: "s26-t7" } };
  "s26-t7": { input: { s: 26; t: 7 }; continueWith: { typeName: "s26-t8" } };
  "s26-t8": { input: { s: 26; t: 8 }; continueWith: { typeName: "s26-t9" } };
  "s26-t9": { input: { s: 26; t: 9 }; continueWith: { typeName: "s26-t10" } };
  "s26-t10": { input: { s: 26; t: 10 }; continueWith: { typeName: "s26-t11" } };
  "s26-t11": { input: { s: 26; t: 11 }; continueWith: { typeName: "s26-t12" } };
  "s26-t12": { input: { s: 26; t: 12 }; continueWith: { typeName: "s26-t13" } };
  "s26-t13": { input: { s: 26; t: 13 }; continueWith: { typeName: "s26-t14" } };
  "s26-t14": { input: { s: 26; t: 14 }; continueWith: { typeName: "s26-t15" } };
  "s26-t15": { input: { s: 26; t: 15 }; continueWith: { typeName: "s26-t16" } };
  "s26-t16": { input: { s: 26; t: 16 }; continueWith: { typeName: "s26-t17" } };
  "s26-t17": { input: { s: 26; t: 17 }; continueWith: { typeName: "s26-t18" } };
  "s26-t18": { input: { s: 26; t: 18 }; continueWith: { typeName: "s26-t19" } };
  "s26-t19": { input: { s: 26; t: 19 }; output: { s: 26; done: true } };
}>();

const slice27 = defineJobTypes<{
  "s27-t0": { entry: true; input: { s: 27; t: 0 }; continueWith: { typeName: "s27-t1" } };
  "s27-t1": { input: { s: 27; t: 1 }; continueWith: { typeName: "s27-t2" } };
  "s27-t2": { input: { s: 27; t: 2 }; continueWith: { typeName: "s27-t3" } };
  "s27-t3": { input: { s: 27; t: 3 }; continueWith: { typeName: "s27-t4" } };
  "s27-t4": { input: { s: 27; t: 4 }; continueWith: { typeName: "s27-t5" } };
  "s27-t5": { input: { s: 27; t: 5 }; continueWith: { typeName: "s27-t6" } };
  "s27-t6": { input: { s: 27; t: 6 }; continueWith: { typeName: "s27-t7" } };
  "s27-t7": { input: { s: 27; t: 7 }; continueWith: { typeName: "s27-t8" } };
  "s27-t8": { input: { s: 27; t: 8 }; continueWith: { typeName: "s27-t9" } };
  "s27-t9": { input: { s: 27; t: 9 }; continueWith: { typeName: "s27-t10" } };
  "s27-t10": { input: { s: 27; t: 10 }; continueWith: { typeName: "s27-t11" } };
  "s27-t11": { input: { s: 27; t: 11 }; continueWith: { typeName: "s27-t12" } };
  "s27-t12": { input: { s: 27; t: 12 }; continueWith: { typeName: "s27-t13" } };
  "s27-t13": { input: { s: 27; t: 13 }; continueWith: { typeName: "s27-t14" } };
  "s27-t14": { input: { s: 27; t: 14 }; continueWith: { typeName: "s27-t15" } };
  "s27-t15": { input: { s: 27; t: 15 }; continueWith: { typeName: "s27-t16" } };
  "s27-t16": { input: { s: 27; t: 16 }; continueWith: { typeName: "s27-t17" } };
  "s27-t17": { input: { s: 27; t: 17 }; continueWith: { typeName: "s27-t18" } };
  "s27-t18": { input: { s: 27; t: 18 }; continueWith: { typeName: "s27-t19" } };
  "s27-t19": { input: { s: 27; t: 19 }; output: { s: 27; done: true } };
}>();

const slice28 = defineJobTypes<{
  "s28-t0": { entry: true; input: { s: 28; t: 0 }; continueWith: { typeName: "s28-t1" } };
  "s28-t1": { input: { s: 28; t: 1 }; continueWith: { typeName: "s28-t2" } };
  "s28-t2": { input: { s: 28; t: 2 }; continueWith: { typeName: "s28-t3" } };
  "s28-t3": { input: { s: 28; t: 3 }; continueWith: { typeName: "s28-t4" } };
  "s28-t4": { input: { s: 28; t: 4 }; continueWith: { typeName: "s28-t5" } };
  "s28-t5": { input: { s: 28; t: 5 }; continueWith: { typeName: "s28-t6" } };
  "s28-t6": { input: { s: 28; t: 6 }; continueWith: { typeName: "s28-t7" } };
  "s28-t7": { input: { s: 28; t: 7 }; continueWith: { typeName: "s28-t8" } };
  "s28-t8": { input: { s: 28; t: 8 }; continueWith: { typeName: "s28-t9" } };
  "s28-t9": { input: { s: 28; t: 9 }; continueWith: { typeName: "s28-t10" } };
  "s28-t10": { input: { s: 28; t: 10 }; continueWith: { typeName: "s28-t11" } };
  "s28-t11": { input: { s: 28; t: 11 }; continueWith: { typeName: "s28-t12" } };
  "s28-t12": { input: { s: 28; t: 12 }; continueWith: { typeName: "s28-t13" } };
  "s28-t13": { input: { s: 28; t: 13 }; continueWith: { typeName: "s28-t14" } };
  "s28-t14": { input: { s: 28; t: 14 }; continueWith: { typeName: "s28-t15" } };
  "s28-t15": { input: { s: 28; t: 15 }; continueWith: { typeName: "s28-t16" } };
  "s28-t16": { input: { s: 28; t: 16 }; continueWith: { typeName: "s28-t17" } };
  "s28-t17": { input: { s: 28; t: 17 }; continueWith: { typeName: "s28-t18" } };
  "s28-t18": { input: { s: 28; t: 18 }; continueWith: { typeName: "s28-t19" } };
  "s28-t19": { input: { s: 28; t: 19 }; output: { s: 28; done: true } };
}>();

const slice29 = defineJobTypes<{
  "s29-t0": { entry: true; input: { s: 29; t: 0 }; continueWith: { typeName: "s29-t1" } };
  "s29-t1": { input: { s: 29; t: 1 }; continueWith: { typeName: "s29-t2" } };
  "s29-t2": { input: { s: 29; t: 2 }; continueWith: { typeName: "s29-t3" } };
  "s29-t3": { input: { s: 29; t: 3 }; continueWith: { typeName: "s29-t4" } };
  "s29-t4": { input: { s: 29; t: 4 }; continueWith: { typeName: "s29-t5" } };
  "s29-t5": { input: { s: 29; t: 5 }; continueWith: { typeName: "s29-t6" } };
  "s29-t6": { input: { s: 29; t: 6 }; continueWith: { typeName: "s29-t7" } };
  "s29-t7": { input: { s: 29; t: 7 }; continueWith: { typeName: "s29-t8" } };
  "s29-t8": { input: { s: 29; t: 8 }; continueWith: { typeName: "s29-t9" } };
  "s29-t9": { input: { s: 29; t: 9 }; continueWith: { typeName: "s29-t10" } };
  "s29-t10": { input: { s: 29; t: 10 }; continueWith: { typeName: "s29-t11" } };
  "s29-t11": { input: { s: 29; t: 11 }; continueWith: { typeName: "s29-t12" } };
  "s29-t12": { input: { s: 29; t: 12 }; continueWith: { typeName: "s29-t13" } };
  "s29-t13": { input: { s: 29; t: 13 }; continueWith: { typeName: "s29-t14" } };
  "s29-t14": { input: { s: 29; t: 14 }; continueWith: { typeName: "s29-t15" } };
  "s29-t15": { input: { s: 29; t: 15 }; continueWith: { typeName: "s29-t16" } };
  "s29-t16": { input: { s: 29; t: 16 }; continueWith: { typeName: "s29-t17" } };
  "s29-t17": { input: { s: 29; t: 17 }; continueWith: { typeName: "s29-t18" } };
  "s29-t18": { input: { s: 29; t: 18 }; continueWith: { typeName: "s29-t19" } };
  "s29-t19": { input: { s: 29; t: 19 }; output: { s: 29; done: true } };
}>();

const slice30 = defineJobTypes<{
  "s30-t0": { entry: true; input: { s: 30; t: 0 }; continueWith: { typeName: "s30-t1" } };
  "s30-t1": { input: { s: 30; t: 1 }; continueWith: { typeName: "s30-t2" } };
  "s30-t2": { input: { s: 30; t: 2 }; continueWith: { typeName: "s30-t3" } };
  "s30-t3": { input: { s: 30; t: 3 }; continueWith: { typeName: "s30-t4" } };
  "s30-t4": { input: { s: 30; t: 4 }; continueWith: { typeName: "s30-t5" } };
  "s30-t5": { input: { s: 30; t: 5 }; continueWith: { typeName: "s30-t6" } };
  "s30-t6": { input: { s: 30; t: 6 }; continueWith: { typeName: "s30-t7" } };
  "s30-t7": { input: { s: 30; t: 7 }; continueWith: { typeName: "s30-t8" } };
  "s30-t8": { input: { s: 30; t: 8 }; continueWith: { typeName: "s30-t9" } };
  "s30-t9": { input: { s: 30; t: 9 }; continueWith: { typeName: "s30-t10" } };
  "s30-t10": { input: { s: 30; t: 10 }; continueWith: { typeName: "s30-t11" } };
  "s30-t11": { input: { s: 30; t: 11 }; continueWith: { typeName: "s30-t12" } };
  "s30-t12": { input: { s: 30; t: 12 }; continueWith: { typeName: "s30-t13" } };
  "s30-t13": { input: { s: 30; t: 13 }; continueWith: { typeName: "s30-t14" } };
  "s30-t14": { input: { s: 30; t: 14 }; continueWith: { typeName: "s30-t15" } };
  "s30-t15": { input: { s: 30; t: 15 }; continueWith: { typeName: "s30-t16" } };
  "s30-t16": { input: { s: 30; t: 16 }; continueWith: { typeName: "s30-t17" } };
  "s30-t17": { input: { s: 30; t: 17 }; continueWith: { typeName: "s30-t18" } };
  "s30-t18": { input: { s: 30; t: 18 }; continueWith: { typeName: "s30-t19" } };
  "s30-t19": { input: { s: 30; t: 19 }; output: { s: 30; done: true } };
}>();

const slice31 = defineJobTypes<{
  "s31-t0": { entry: true; input: { s: 31; t: 0 }; continueWith: { typeName: "s31-t1" } };
  "s31-t1": { input: { s: 31; t: 1 }; continueWith: { typeName: "s31-t2" } };
  "s31-t2": { input: { s: 31; t: 2 }; continueWith: { typeName: "s31-t3" } };
  "s31-t3": { input: { s: 31; t: 3 }; continueWith: { typeName: "s31-t4" } };
  "s31-t4": { input: { s: 31; t: 4 }; continueWith: { typeName: "s31-t5" } };
  "s31-t5": { input: { s: 31; t: 5 }; continueWith: { typeName: "s31-t6" } };
  "s31-t6": { input: { s: 31; t: 6 }; continueWith: { typeName: "s31-t7" } };
  "s31-t7": { input: { s: 31; t: 7 }; continueWith: { typeName: "s31-t8" } };
  "s31-t8": { input: { s: 31; t: 8 }; continueWith: { typeName: "s31-t9" } };
  "s31-t9": { input: { s: 31; t: 9 }; continueWith: { typeName: "s31-t10" } };
  "s31-t10": { input: { s: 31; t: 10 }; continueWith: { typeName: "s31-t11" } };
  "s31-t11": { input: { s: 31; t: 11 }; continueWith: { typeName: "s31-t12" } };
  "s31-t12": { input: { s: 31; t: 12 }; continueWith: { typeName: "s31-t13" } };
  "s31-t13": { input: { s: 31; t: 13 }; continueWith: { typeName: "s31-t14" } };
  "s31-t14": { input: { s: 31; t: 14 }; continueWith: { typeName: "s31-t15" } };
  "s31-t15": { input: { s: 31; t: 15 }; continueWith: { typeName: "s31-t16" } };
  "s31-t16": { input: { s: 31; t: 16 }; continueWith: { typeName: "s31-t17" } };
  "s31-t17": { input: { s: 31; t: 17 }; continueWith: { typeName: "s31-t18" } };
  "s31-t18": { input: { s: 31; t: 18 }; continueWith: { typeName: "s31-t19" } };
  "s31-t19": { input: { s: 31; t: 19 }; output: { s: 31; done: true } };
}>();

const slice32 = defineJobTypes<{
  "s32-t0": { entry: true; input: { s: 32; t: 0 }; continueWith: { typeName: "s32-t1" } };
  "s32-t1": { input: { s: 32; t: 1 }; continueWith: { typeName: "s32-t2" } };
  "s32-t2": { input: { s: 32; t: 2 }; continueWith: { typeName: "s32-t3" } };
  "s32-t3": { input: { s: 32; t: 3 }; continueWith: { typeName: "s32-t4" } };
  "s32-t4": { input: { s: 32; t: 4 }; continueWith: { typeName: "s32-t5" } };
  "s32-t5": { input: { s: 32; t: 5 }; continueWith: { typeName: "s32-t6" } };
  "s32-t6": { input: { s: 32; t: 6 }; continueWith: { typeName: "s32-t7" } };
  "s32-t7": { input: { s: 32; t: 7 }; continueWith: { typeName: "s32-t8" } };
  "s32-t8": { input: { s: 32; t: 8 }; continueWith: { typeName: "s32-t9" } };
  "s32-t9": { input: { s: 32; t: 9 }; continueWith: { typeName: "s32-t10" } };
  "s32-t10": { input: { s: 32; t: 10 }; continueWith: { typeName: "s32-t11" } };
  "s32-t11": { input: { s: 32; t: 11 }; continueWith: { typeName: "s32-t12" } };
  "s32-t12": { input: { s: 32; t: 12 }; continueWith: { typeName: "s32-t13" } };
  "s32-t13": { input: { s: 32; t: 13 }; continueWith: { typeName: "s32-t14" } };
  "s32-t14": { input: { s: 32; t: 14 }; continueWith: { typeName: "s32-t15" } };
  "s32-t15": { input: { s: 32; t: 15 }; continueWith: { typeName: "s32-t16" } };
  "s32-t16": { input: { s: 32; t: 16 }; continueWith: { typeName: "s32-t17" } };
  "s32-t17": { input: { s: 32; t: 17 }; continueWith: { typeName: "s32-t18" } };
  "s32-t18": { input: { s: 32; t: 18 }; continueWith: { typeName: "s32-t19" } };
  "s32-t19": { input: { s: 32; t: 19 }; output: { s: 32; done: true } };
}>();

const slice33 = defineJobTypes<{
  "s33-t0": { entry: true; input: { s: 33; t: 0 }; continueWith: { typeName: "s33-t1" } };
  "s33-t1": { input: { s: 33; t: 1 }; continueWith: { typeName: "s33-t2" } };
  "s33-t2": { input: { s: 33; t: 2 }; continueWith: { typeName: "s33-t3" } };
  "s33-t3": { input: { s: 33; t: 3 }; continueWith: { typeName: "s33-t4" } };
  "s33-t4": { input: { s: 33; t: 4 }; continueWith: { typeName: "s33-t5" } };
  "s33-t5": { input: { s: 33; t: 5 }; continueWith: { typeName: "s33-t6" } };
  "s33-t6": { input: { s: 33; t: 6 }; continueWith: { typeName: "s33-t7" } };
  "s33-t7": { input: { s: 33; t: 7 }; continueWith: { typeName: "s33-t8" } };
  "s33-t8": { input: { s: 33; t: 8 }; continueWith: { typeName: "s33-t9" } };
  "s33-t9": { input: { s: 33; t: 9 }; continueWith: { typeName: "s33-t10" } };
  "s33-t10": { input: { s: 33; t: 10 }; continueWith: { typeName: "s33-t11" } };
  "s33-t11": { input: { s: 33; t: 11 }; continueWith: { typeName: "s33-t12" } };
  "s33-t12": { input: { s: 33; t: 12 }; continueWith: { typeName: "s33-t13" } };
  "s33-t13": { input: { s: 33; t: 13 }; continueWith: { typeName: "s33-t14" } };
  "s33-t14": { input: { s: 33; t: 14 }; continueWith: { typeName: "s33-t15" } };
  "s33-t15": { input: { s: 33; t: 15 }; continueWith: { typeName: "s33-t16" } };
  "s33-t16": { input: { s: 33; t: 16 }; continueWith: { typeName: "s33-t17" } };
  "s33-t17": { input: { s: 33; t: 17 }; continueWith: { typeName: "s33-t18" } };
  "s33-t18": { input: { s: 33; t: 18 }; continueWith: { typeName: "s33-t19" } };
  "s33-t19": { input: { s: 33; t: 19 }; output: { s: 33; done: true } };
}>();

const slice34 = defineJobTypes<{
  "s34-t0": { entry: true; input: { s: 34; t: 0 }; continueWith: { typeName: "s34-t1" } };
  "s34-t1": { input: { s: 34; t: 1 }; continueWith: { typeName: "s34-t2" } };
  "s34-t2": { input: { s: 34; t: 2 }; continueWith: { typeName: "s34-t3" } };
  "s34-t3": { input: { s: 34; t: 3 }; continueWith: { typeName: "s34-t4" } };
  "s34-t4": { input: { s: 34; t: 4 }; continueWith: { typeName: "s34-t5" } };
  "s34-t5": { input: { s: 34; t: 5 }; continueWith: { typeName: "s34-t6" } };
  "s34-t6": { input: { s: 34; t: 6 }; continueWith: { typeName: "s34-t7" } };
  "s34-t7": { input: { s: 34; t: 7 }; continueWith: { typeName: "s34-t8" } };
  "s34-t8": { input: { s: 34; t: 8 }; continueWith: { typeName: "s34-t9" } };
  "s34-t9": { input: { s: 34; t: 9 }; continueWith: { typeName: "s34-t10" } };
  "s34-t10": { input: { s: 34; t: 10 }; continueWith: { typeName: "s34-t11" } };
  "s34-t11": { input: { s: 34; t: 11 }; continueWith: { typeName: "s34-t12" } };
  "s34-t12": { input: { s: 34; t: 12 }; continueWith: { typeName: "s34-t13" } };
  "s34-t13": { input: { s: 34; t: 13 }; continueWith: { typeName: "s34-t14" } };
  "s34-t14": { input: { s: 34; t: 14 }; continueWith: { typeName: "s34-t15" } };
  "s34-t15": { input: { s: 34; t: 15 }; continueWith: { typeName: "s34-t16" } };
  "s34-t16": { input: { s: 34; t: 16 }; continueWith: { typeName: "s34-t17" } };
  "s34-t17": { input: { s: 34; t: 17 }; continueWith: { typeName: "s34-t18" } };
  "s34-t18": { input: { s: 34; t: 18 }; continueWith: { typeName: "s34-t19" } };
  "s34-t19": { input: { s: 34; t: 19 }; output: { s: 34; done: true } };
}>();

const slice35 = defineJobTypes<{
  "s35-t0": { entry: true; input: { s: 35; t: 0 }; continueWith: { typeName: "s35-t1" } };
  "s35-t1": { input: { s: 35; t: 1 }; continueWith: { typeName: "s35-t2" } };
  "s35-t2": { input: { s: 35; t: 2 }; continueWith: { typeName: "s35-t3" } };
  "s35-t3": { input: { s: 35; t: 3 }; continueWith: { typeName: "s35-t4" } };
  "s35-t4": { input: { s: 35; t: 4 }; continueWith: { typeName: "s35-t5" } };
  "s35-t5": { input: { s: 35; t: 5 }; continueWith: { typeName: "s35-t6" } };
  "s35-t6": { input: { s: 35; t: 6 }; continueWith: { typeName: "s35-t7" } };
  "s35-t7": { input: { s: 35; t: 7 }; continueWith: { typeName: "s35-t8" } };
  "s35-t8": { input: { s: 35; t: 8 }; continueWith: { typeName: "s35-t9" } };
  "s35-t9": { input: { s: 35; t: 9 }; continueWith: { typeName: "s35-t10" } };
  "s35-t10": { input: { s: 35; t: 10 }; continueWith: { typeName: "s35-t11" } };
  "s35-t11": { input: { s: 35; t: 11 }; continueWith: { typeName: "s35-t12" } };
  "s35-t12": { input: { s: 35; t: 12 }; continueWith: { typeName: "s35-t13" } };
  "s35-t13": { input: { s: 35; t: 13 }; continueWith: { typeName: "s35-t14" } };
  "s35-t14": { input: { s: 35; t: 14 }; continueWith: { typeName: "s35-t15" } };
  "s35-t15": { input: { s: 35; t: 15 }; continueWith: { typeName: "s35-t16" } };
  "s35-t16": { input: { s: 35; t: 16 }; continueWith: { typeName: "s35-t17" } };
  "s35-t17": { input: { s: 35; t: 17 }; continueWith: { typeName: "s35-t18" } };
  "s35-t18": { input: { s: 35; t: 18 }; continueWith: { typeName: "s35-t19" } };
  "s35-t19": { input: { s: 35; t: 19 }; output: { s: 35; done: true } };
}>();

const slice36 = defineJobTypes<{
  "s36-t0": { entry: true; input: { s: 36; t: 0 }; continueWith: { typeName: "s36-t1" } };
  "s36-t1": { input: { s: 36; t: 1 }; continueWith: { typeName: "s36-t2" } };
  "s36-t2": { input: { s: 36; t: 2 }; continueWith: { typeName: "s36-t3" } };
  "s36-t3": { input: { s: 36; t: 3 }; continueWith: { typeName: "s36-t4" } };
  "s36-t4": { input: { s: 36; t: 4 }; continueWith: { typeName: "s36-t5" } };
  "s36-t5": { input: { s: 36; t: 5 }; continueWith: { typeName: "s36-t6" } };
  "s36-t6": { input: { s: 36; t: 6 }; continueWith: { typeName: "s36-t7" } };
  "s36-t7": { input: { s: 36; t: 7 }; continueWith: { typeName: "s36-t8" } };
  "s36-t8": { input: { s: 36; t: 8 }; continueWith: { typeName: "s36-t9" } };
  "s36-t9": { input: { s: 36; t: 9 }; continueWith: { typeName: "s36-t10" } };
  "s36-t10": { input: { s: 36; t: 10 }; continueWith: { typeName: "s36-t11" } };
  "s36-t11": { input: { s: 36; t: 11 }; continueWith: { typeName: "s36-t12" } };
  "s36-t12": { input: { s: 36; t: 12 }; continueWith: { typeName: "s36-t13" } };
  "s36-t13": { input: { s: 36; t: 13 }; continueWith: { typeName: "s36-t14" } };
  "s36-t14": { input: { s: 36; t: 14 }; continueWith: { typeName: "s36-t15" } };
  "s36-t15": { input: { s: 36; t: 15 }; continueWith: { typeName: "s36-t16" } };
  "s36-t16": { input: { s: 36; t: 16 }; continueWith: { typeName: "s36-t17" } };
  "s36-t17": { input: { s: 36; t: 17 }; continueWith: { typeName: "s36-t18" } };
  "s36-t18": { input: { s: 36; t: 18 }; continueWith: { typeName: "s36-t19" } };
  "s36-t19": { input: { s: 36; t: 19 }; output: { s: 36; done: true } };
}>();

const slice37 = defineJobTypes<{
  "s37-t0": { entry: true; input: { s: 37; t: 0 }; continueWith: { typeName: "s37-t1" } };
  "s37-t1": { input: { s: 37; t: 1 }; continueWith: { typeName: "s37-t2" } };
  "s37-t2": { input: { s: 37; t: 2 }; continueWith: { typeName: "s37-t3" } };
  "s37-t3": { input: { s: 37; t: 3 }; continueWith: { typeName: "s37-t4" } };
  "s37-t4": { input: { s: 37; t: 4 }; continueWith: { typeName: "s37-t5" } };
  "s37-t5": { input: { s: 37; t: 5 }; continueWith: { typeName: "s37-t6" } };
  "s37-t6": { input: { s: 37; t: 6 }; continueWith: { typeName: "s37-t7" } };
  "s37-t7": { input: { s: 37; t: 7 }; continueWith: { typeName: "s37-t8" } };
  "s37-t8": { input: { s: 37; t: 8 }; continueWith: { typeName: "s37-t9" } };
  "s37-t9": { input: { s: 37; t: 9 }; continueWith: { typeName: "s37-t10" } };
  "s37-t10": { input: { s: 37; t: 10 }; continueWith: { typeName: "s37-t11" } };
  "s37-t11": { input: { s: 37; t: 11 }; continueWith: { typeName: "s37-t12" } };
  "s37-t12": { input: { s: 37; t: 12 }; continueWith: { typeName: "s37-t13" } };
  "s37-t13": { input: { s: 37; t: 13 }; continueWith: { typeName: "s37-t14" } };
  "s37-t14": { input: { s: 37; t: 14 }; continueWith: { typeName: "s37-t15" } };
  "s37-t15": { input: { s: 37; t: 15 }; continueWith: { typeName: "s37-t16" } };
  "s37-t16": { input: { s: 37; t: 16 }; continueWith: { typeName: "s37-t17" } };
  "s37-t17": { input: { s: 37; t: 17 }; continueWith: { typeName: "s37-t18" } };
  "s37-t18": { input: { s: 37; t: 18 }; continueWith: { typeName: "s37-t19" } };
  "s37-t19": { input: { s: 37; t: 19 }; output: { s: 37; done: true } };
}>();

const slice38 = defineJobTypes<{
  "s38-t0": { entry: true; input: { s: 38; t: 0 }; continueWith: { typeName: "s38-t1" } };
  "s38-t1": { input: { s: 38; t: 1 }; continueWith: { typeName: "s38-t2" } };
  "s38-t2": { input: { s: 38; t: 2 }; continueWith: { typeName: "s38-t3" } };
  "s38-t3": { input: { s: 38; t: 3 }; continueWith: { typeName: "s38-t4" } };
  "s38-t4": { input: { s: 38; t: 4 }; continueWith: { typeName: "s38-t5" } };
  "s38-t5": { input: { s: 38; t: 5 }; continueWith: { typeName: "s38-t6" } };
  "s38-t6": { input: { s: 38; t: 6 }; continueWith: { typeName: "s38-t7" } };
  "s38-t7": { input: { s: 38; t: 7 }; continueWith: { typeName: "s38-t8" } };
  "s38-t8": { input: { s: 38; t: 8 }; continueWith: { typeName: "s38-t9" } };
  "s38-t9": { input: { s: 38; t: 9 }; continueWith: { typeName: "s38-t10" } };
  "s38-t10": { input: { s: 38; t: 10 }; continueWith: { typeName: "s38-t11" } };
  "s38-t11": { input: { s: 38; t: 11 }; continueWith: { typeName: "s38-t12" } };
  "s38-t12": { input: { s: 38; t: 12 }; continueWith: { typeName: "s38-t13" } };
  "s38-t13": { input: { s: 38; t: 13 }; continueWith: { typeName: "s38-t14" } };
  "s38-t14": { input: { s: 38; t: 14 }; continueWith: { typeName: "s38-t15" } };
  "s38-t15": { input: { s: 38; t: 15 }; continueWith: { typeName: "s38-t16" } };
  "s38-t16": { input: { s: 38; t: 16 }; continueWith: { typeName: "s38-t17" } };
  "s38-t17": { input: { s: 38; t: 17 }; continueWith: { typeName: "s38-t18" } };
  "s38-t18": { input: { s: 38; t: 18 }; continueWith: { typeName: "s38-t19" } };
  "s38-t19": { input: { s: 38; t: 19 }; output: { s: 38; done: true } };
}>();

const slice39 = defineJobTypes<{
  "s39-t0": { entry: true; input: { s: 39; t: 0 }; continueWith: { typeName: "s39-t1" } };
  "s39-t1": { input: { s: 39; t: 1 }; continueWith: { typeName: "s39-t2" } };
  "s39-t2": { input: { s: 39; t: 2 }; continueWith: { typeName: "s39-t3" } };
  "s39-t3": { input: { s: 39; t: 3 }; continueWith: { typeName: "s39-t4" } };
  "s39-t4": { input: { s: 39; t: 4 }; continueWith: { typeName: "s39-t5" } };
  "s39-t5": { input: { s: 39; t: 5 }; continueWith: { typeName: "s39-t6" } };
  "s39-t6": { input: { s: 39; t: 6 }; continueWith: { typeName: "s39-t7" } };
  "s39-t7": { input: { s: 39; t: 7 }; continueWith: { typeName: "s39-t8" } };
  "s39-t8": { input: { s: 39; t: 8 }; continueWith: { typeName: "s39-t9" } };
  "s39-t9": { input: { s: 39; t: 9 }; continueWith: { typeName: "s39-t10" } };
  "s39-t10": { input: { s: 39; t: 10 }; continueWith: { typeName: "s39-t11" } };
  "s39-t11": { input: { s: 39; t: 11 }; continueWith: { typeName: "s39-t12" } };
  "s39-t12": { input: { s: 39; t: 12 }; continueWith: { typeName: "s39-t13" } };
  "s39-t13": { input: { s: 39; t: 13 }; continueWith: { typeName: "s39-t14" } };
  "s39-t14": { input: { s: 39; t: 14 }; continueWith: { typeName: "s39-t15" } };
  "s39-t15": { input: { s: 39; t: 15 }; continueWith: { typeName: "s39-t16" } };
  "s39-t16": { input: { s: 39; t: 16 }; continueWith: { typeName: "s39-t17" } };
  "s39-t17": { input: { s: 39; t: 17 }; continueWith: { typeName: "s39-t18" } };
  "s39-t18": { input: { s: 39; t: 18 }; continueWith: { typeName: "s39-t19" } };
  "s39-t19": { input: { s: 39; t: 19 }; output: { s: 39; done: true } };
}>();

const slice40 = defineJobTypes<{
  "s40-t0": { entry: true; input: { s: 40; t: 0 }; continueWith: { typeName: "s40-t1" } };
  "s40-t1": { input: { s: 40; t: 1 }; continueWith: { typeName: "s40-t2" } };
  "s40-t2": { input: { s: 40; t: 2 }; continueWith: { typeName: "s40-t3" } };
  "s40-t3": { input: { s: 40; t: 3 }; continueWith: { typeName: "s40-t4" } };
  "s40-t4": { input: { s: 40; t: 4 }; continueWith: { typeName: "s40-t5" } };
  "s40-t5": { input: { s: 40; t: 5 }; continueWith: { typeName: "s40-t6" } };
  "s40-t6": { input: { s: 40; t: 6 }; continueWith: { typeName: "s40-t7" } };
  "s40-t7": { input: { s: 40; t: 7 }; continueWith: { typeName: "s40-t8" } };
  "s40-t8": { input: { s: 40; t: 8 }; continueWith: { typeName: "s40-t9" } };
  "s40-t9": { input: { s: 40; t: 9 }; continueWith: { typeName: "s40-t10" } };
  "s40-t10": { input: { s: 40; t: 10 }; continueWith: { typeName: "s40-t11" } };
  "s40-t11": { input: { s: 40; t: 11 }; continueWith: { typeName: "s40-t12" } };
  "s40-t12": { input: { s: 40; t: 12 }; continueWith: { typeName: "s40-t13" } };
  "s40-t13": { input: { s: 40; t: 13 }; continueWith: { typeName: "s40-t14" } };
  "s40-t14": { input: { s: 40; t: 14 }; continueWith: { typeName: "s40-t15" } };
  "s40-t15": { input: { s: 40; t: 15 }; continueWith: { typeName: "s40-t16" } };
  "s40-t16": { input: { s: 40; t: 16 }; continueWith: { typeName: "s40-t17" } };
  "s40-t17": { input: { s: 40; t: 17 }; continueWith: { typeName: "s40-t18" } };
  "s40-t18": { input: { s: 40; t: 18 }; continueWith: { typeName: "s40-t19" } };
  "s40-t19": { input: { s: 40; t: 19 }; output: { s: 40; done: true } };
}>();

const slice41 = defineJobTypes<{
  "s41-t0": { entry: true; input: { s: 41; t: 0 }; continueWith: { typeName: "s41-t1" } };
  "s41-t1": { input: { s: 41; t: 1 }; continueWith: { typeName: "s41-t2" } };
  "s41-t2": { input: { s: 41; t: 2 }; continueWith: { typeName: "s41-t3" } };
  "s41-t3": { input: { s: 41; t: 3 }; continueWith: { typeName: "s41-t4" } };
  "s41-t4": { input: { s: 41; t: 4 }; continueWith: { typeName: "s41-t5" } };
  "s41-t5": { input: { s: 41; t: 5 }; continueWith: { typeName: "s41-t6" } };
  "s41-t6": { input: { s: 41; t: 6 }; continueWith: { typeName: "s41-t7" } };
  "s41-t7": { input: { s: 41; t: 7 }; continueWith: { typeName: "s41-t8" } };
  "s41-t8": { input: { s: 41; t: 8 }; continueWith: { typeName: "s41-t9" } };
  "s41-t9": { input: { s: 41; t: 9 }; continueWith: { typeName: "s41-t10" } };
  "s41-t10": { input: { s: 41; t: 10 }; continueWith: { typeName: "s41-t11" } };
  "s41-t11": { input: { s: 41; t: 11 }; continueWith: { typeName: "s41-t12" } };
  "s41-t12": { input: { s: 41; t: 12 }; continueWith: { typeName: "s41-t13" } };
  "s41-t13": { input: { s: 41; t: 13 }; continueWith: { typeName: "s41-t14" } };
  "s41-t14": { input: { s: 41; t: 14 }; continueWith: { typeName: "s41-t15" } };
  "s41-t15": { input: { s: 41; t: 15 }; continueWith: { typeName: "s41-t16" } };
  "s41-t16": { input: { s: 41; t: 16 }; continueWith: { typeName: "s41-t17" } };
  "s41-t17": { input: { s: 41; t: 17 }; continueWith: { typeName: "s41-t18" } };
  "s41-t18": { input: { s: 41; t: 18 }; continueWith: { typeName: "s41-t19" } };
  "s41-t19": { input: { s: 41; t: 19 }; output: { s: 41; done: true } };
}>();

const slice42 = defineJobTypes<{
  "s42-t0": { entry: true; input: { s: 42; t: 0 }; continueWith: { typeName: "s42-t1" } };
  "s42-t1": { input: { s: 42; t: 1 }; continueWith: { typeName: "s42-t2" } };
  "s42-t2": { input: { s: 42; t: 2 }; continueWith: { typeName: "s42-t3" } };
  "s42-t3": { input: { s: 42; t: 3 }; continueWith: { typeName: "s42-t4" } };
  "s42-t4": { input: { s: 42; t: 4 }; continueWith: { typeName: "s42-t5" } };
  "s42-t5": { input: { s: 42; t: 5 }; continueWith: { typeName: "s42-t6" } };
  "s42-t6": { input: { s: 42; t: 6 }; continueWith: { typeName: "s42-t7" } };
  "s42-t7": { input: { s: 42; t: 7 }; continueWith: { typeName: "s42-t8" } };
  "s42-t8": { input: { s: 42; t: 8 }; continueWith: { typeName: "s42-t9" } };
  "s42-t9": { input: { s: 42; t: 9 }; continueWith: { typeName: "s42-t10" } };
  "s42-t10": { input: { s: 42; t: 10 }; continueWith: { typeName: "s42-t11" } };
  "s42-t11": { input: { s: 42; t: 11 }; continueWith: { typeName: "s42-t12" } };
  "s42-t12": { input: { s: 42; t: 12 }; continueWith: { typeName: "s42-t13" } };
  "s42-t13": { input: { s: 42; t: 13 }; continueWith: { typeName: "s42-t14" } };
  "s42-t14": { input: { s: 42; t: 14 }; continueWith: { typeName: "s42-t15" } };
  "s42-t15": { input: { s: 42; t: 15 }; continueWith: { typeName: "s42-t16" } };
  "s42-t16": { input: { s: 42; t: 16 }; continueWith: { typeName: "s42-t17" } };
  "s42-t17": { input: { s: 42; t: 17 }; continueWith: { typeName: "s42-t18" } };
  "s42-t18": { input: { s: 42; t: 18 }; continueWith: { typeName: "s42-t19" } };
  "s42-t19": { input: { s: 42; t: 19 }; output: { s: 42; done: true } };
}>();

const slice43 = defineJobTypes<{
  "s43-t0": { entry: true; input: { s: 43; t: 0 }; continueWith: { typeName: "s43-t1" } };
  "s43-t1": { input: { s: 43; t: 1 }; continueWith: { typeName: "s43-t2" } };
  "s43-t2": { input: { s: 43; t: 2 }; continueWith: { typeName: "s43-t3" } };
  "s43-t3": { input: { s: 43; t: 3 }; continueWith: { typeName: "s43-t4" } };
  "s43-t4": { input: { s: 43; t: 4 }; continueWith: { typeName: "s43-t5" } };
  "s43-t5": { input: { s: 43; t: 5 }; continueWith: { typeName: "s43-t6" } };
  "s43-t6": { input: { s: 43; t: 6 }; continueWith: { typeName: "s43-t7" } };
  "s43-t7": { input: { s: 43; t: 7 }; continueWith: { typeName: "s43-t8" } };
  "s43-t8": { input: { s: 43; t: 8 }; continueWith: { typeName: "s43-t9" } };
  "s43-t9": { input: { s: 43; t: 9 }; continueWith: { typeName: "s43-t10" } };
  "s43-t10": { input: { s: 43; t: 10 }; continueWith: { typeName: "s43-t11" } };
  "s43-t11": { input: { s: 43; t: 11 }; continueWith: { typeName: "s43-t12" } };
  "s43-t12": { input: { s: 43; t: 12 }; continueWith: { typeName: "s43-t13" } };
  "s43-t13": { input: { s: 43; t: 13 }; continueWith: { typeName: "s43-t14" } };
  "s43-t14": { input: { s: 43; t: 14 }; continueWith: { typeName: "s43-t15" } };
  "s43-t15": { input: { s: 43; t: 15 }; continueWith: { typeName: "s43-t16" } };
  "s43-t16": { input: { s: 43; t: 16 }; continueWith: { typeName: "s43-t17" } };
  "s43-t17": { input: { s: 43; t: 17 }; continueWith: { typeName: "s43-t18" } };
  "s43-t18": { input: { s: 43; t: 18 }; continueWith: { typeName: "s43-t19" } };
  "s43-t19": { input: { s: 43; t: 19 }; output: { s: 43; done: true } };
}>();

const slice44 = defineJobTypes<{
  "s44-t0": { entry: true; input: { s: 44; t: 0 }; continueWith: { typeName: "s44-t1" } };
  "s44-t1": { input: { s: 44; t: 1 }; continueWith: { typeName: "s44-t2" } };
  "s44-t2": { input: { s: 44; t: 2 }; continueWith: { typeName: "s44-t3" } };
  "s44-t3": { input: { s: 44; t: 3 }; continueWith: { typeName: "s44-t4" } };
  "s44-t4": { input: { s: 44; t: 4 }; continueWith: { typeName: "s44-t5" } };
  "s44-t5": { input: { s: 44; t: 5 }; continueWith: { typeName: "s44-t6" } };
  "s44-t6": { input: { s: 44; t: 6 }; continueWith: { typeName: "s44-t7" } };
  "s44-t7": { input: { s: 44; t: 7 }; continueWith: { typeName: "s44-t8" } };
  "s44-t8": { input: { s: 44; t: 8 }; continueWith: { typeName: "s44-t9" } };
  "s44-t9": { input: { s: 44; t: 9 }; continueWith: { typeName: "s44-t10" } };
  "s44-t10": { input: { s: 44; t: 10 }; continueWith: { typeName: "s44-t11" } };
  "s44-t11": { input: { s: 44; t: 11 }; continueWith: { typeName: "s44-t12" } };
  "s44-t12": { input: { s: 44; t: 12 }; continueWith: { typeName: "s44-t13" } };
  "s44-t13": { input: { s: 44; t: 13 }; continueWith: { typeName: "s44-t14" } };
  "s44-t14": { input: { s: 44; t: 14 }; continueWith: { typeName: "s44-t15" } };
  "s44-t15": { input: { s: 44; t: 15 }; continueWith: { typeName: "s44-t16" } };
  "s44-t16": { input: { s: 44; t: 16 }; continueWith: { typeName: "s44-t17" } };
  "s44-t17": { input: { s: 44; t: 17 }; continueWith: { typeName: "s44-t18" } };
  "s44-t18": { input: { s: 44; t: 18 }; continueWith: { typeName: "s44-t19" } };
  "s44-t19": { input: { s: 44; t: 19 }; output: { s: 44; done: true } };
}>();

const slice45 = defineJobTypes<{
  "s45-t0": { entry: true; input: { s: 45; t: 0 }; continueWith: { typeName: "s45-t1" } };
  "s45-t1": { input: { s: 45; t: 1 }; continueWith: { typeName: "s45-t2" } };
  "s45-t2": { input: { s: 45; t: 2 }; continueWith: { typeName: "s45-t3" } };
  "s45-t3": { input: { s: 45; t: 3 }; continueWith: { typeName: "s45-t4" } };
  "s45-t4": { input: { s: 45; t: 4 }; continueWith: { typeName: "s45-t5" } };
  "s45-t5": { input: { s: 45; t: 5 }; continueWith: { typeName: "s45-t6" } };
  "s45-t6": { input: { s: 45; t: 6 }; continueWith: { typeName: "s45-t7" } };
  "s45-t7": { input: { s: 45; t: 7 }; continueWith: { typeName: "s45-t8" } };
  "s45-t8": { input: { s: 45; t: 8 }; continueWith: { typeName: "s45-t9" } };
  "s45-t9": { input: { s: 45; t: 9 }; continueWith: { typeName: "s45-t10" } };
  "s45-t10": { input: { s: 45; t: 10 }; continueWith: { typeName: "s45-t11" } };
  "s45-t11": { input: { s: 45; t: 11 }; continueWith: { typeName: "s45-t12" } };
  "s45-t12": { input: { s: 45; t: 12 }; continueWith: { typeName: "s45-t13" } };
  "s45-t13": { input: { s: 45; t: 13 }; continueWith: { typeName: "s45-t14" } };
  "s45-t14": { input: { s: 45; t: 14 }; continueWith: { typeName: "s45-t15" } };
  "s45-t15": { input: { s: 45; t: 15 }; continueWith: { typeName: "s45-t16" } };
  "s45-t16": { input: { s: 45; t: 16 }; continueWith: { typeName: "s45-t17" } };
  "s45-t17": { input: { s: 45; t: 17 }; continueWith: { typeName: "s45-t18" } };
  "s45-t18": { input: { s: 45; t: 18 }; continueWith: { typeName: "s45-t19" } };
  "s45-t19": { input: { s: 45; t: 19 }; output: { s: 45; done: true } };
}>();

const slice46 = defineJobTypes<{
  "s46-t0": { entry: true; input: { s: 46; t: 0 }; continueWith: { typeName: "s46-t1" } };
  "s46-t1": { input: { s: 46; t: 1 }; continueWith: { typeName: "s46-t2" } };
  "s46-t2": { input: { s: 46; t: 2 }; continueWith: { typeName: "s46-t3" } };
  "s46-t3": { input: { s: 46; t: 3 }; continueWith: { typeName: "s46-t4" } };
  "s46-t4": { input: { s: 46; t: 4 }; continueWith: { typeName: "s46-t5" } };
  "s46-t5": { input: { s: 46; t: 5 }; continueWith: { typeName: "s46-t6" } };
  "s46-t6": { input: { s: 46; t: 6 }; continueWith: { typeName: "s46-t7" } };
  "s46-t7": { input: { s: 46; t: 7 }; continueWith: { typeName: "s46-t8" } };
  "s46-t8": { input: { s: 46; t: 8 }; continueWith: { typeName: "s46-t9" } };
  "s46-t9": { input: { s: 46; t: 9 }; continueWith: { typeName: "s46-t10" } };
  "s46-t10": { input: { s: 46; t: 10 }; continueWith: { typeName: "s46-t11" } };
  "s46-t11": { input: { s: 46; t: 11 }; continueWith: { typeName: "s46-t12" } };
  "s46-t12": { input: { s: 46; t: 12 }; continueWith: { typeName: "s46-t13" } };
  "s46-t13": { input: { s: 46; t: 13 }; continueWith: { typeName: "s46-t14" } };
  "s46-t14": { input: { s: 46; t: 14 }; continueWith: { typeName: "s46-t15" } };
  "s46-t15": { input: { s: 46; t: 15 }; continueWith: { typeName: "s46-t16" } };
  "s46-t16": { input: { s: 46; t: 16 }; continueWith: { typeName: "s46-t17" } };
  "s46-t17": { input: { s: 46; t: 17 }; continueWith: { typeName: "s46-t18" } };
  "s46-t18": { input: { s: 46; t: 18 }; continueWith: { typeName: "s46-t19" } };
  "s46-t19": { input: { s: 46; t: 19 }; output: { s: 46; done: true } };
}>();

const slice47 = defineJobTypes<{
  "s47-t0": { entry: true; input: { s: 47; t: 0 }; continueWith: { typeName: "s47-t1" } };
  "s47-t1": { input: { s: 47; t: 1 }; continueWith: { typeName: "s47-t2" } };
  "s47-t2": { input: { s: 47; t: 2 }; continueWith: { typeName: "s47-t3" } };
  "s47-t3": { input: { s: 47; t: 3 }; continueWith: { typeName: "s47-t4" } };
  "s47-t4": { input: { s: 47; t: 4 }; continueWith: { typeName: "s47-t5" } };
  "s47-t5": { input: { s: 47; t: 5 }; continueWith: { typeName: "s47-t6" } };
  "s47-t6": { input: { s: 47; t: 6 }; continueWith: { typeName: "s47-t7" } };
  "s47-t7": { input: { s: 47; t: 7 }; continueWith: { typeName: "s47-t8" } };
  "s47-t8": { input: { s: 47; t: 8 }; continueWith: { typeName: "s47-t9" } };
  "s47-t9": { input: { s: 47; t: 9 }; continueWith: { typeName: "s47-t10" } };
  "s47-t10": { input: { s: 47; t: 10 }; continueWith: { typeName: "s47-t11" } };
  "s47-t11": { input: { s: 47; t: 11 }; continueWith: { typeName: "s47-t12" } };
  "s47-t12": { input: { s: 47; t: 12 }; continueWith: { typeName: "s47-t13" } };
  "s47-t13": { input: { s: 47; t: 13 }; continueWith: { typeName: "s47-t14" } };
  "s47-t14": { input: { s: 47; t: 14 }; continueWith: { typeName: "s47-t15" } };
  "s47-t15": { input: { s: 47; t: 15 }; continueWith: { typeName: "s47-t16" } };
  "s47-t16": { input: { s: 47; t: 16 }; continueWith: { typeName: "s47-t17" } };
  "s47-t17": { input: { s: 47; t: 17 }; continueWith: { typeName: "s47-t18" } };
  "s47-t18": { input: { s: 47; t: 18 }; continueWith: { typeName: "s47-t19" } };
  "s47-t19": { input: { s: 47; t: 19 }; output: { s: 47; done: true } };
}>();

const slice48 = defineJobTypes<{
  "s48-t0": { entry: true; input: { s: 48; t: 0 }; continueWith: { typeName: "s48-t1" } };
  "s48-t1": { input: { s: 48; t: 1 }; continueWith: { typeName: "s48-t2" } };
  "s48-t2": { input: { s: 48; t: 2 }; continueWith: { typeName: "s48-t3" } };
  "s48-t3": { input: { s: 48; t: 3 }; continueWith: { typeName: "s48-t4" } };
  "s48-t4": { input: { s: 48; t: 4 }; continueWith: { typeName: "s48-t5" } };
  "s48-t5": { input: { s: 48; t: 5 }; continueWith: { typeName: "s48-t6" } };
  "s48-t6": { input: { s: 48; t: 6 }; continueWith: { typeName: "s48-t7" } };
  "s48-t7": { input: { s: 48; t: 7 }; continueWith: { typeName: "s48-t8" } };
  "s48-t8": { input: { s: 48; t: 8 }; continueWith: { typeName: "s48-t9" } };
  "s48-t9": { input: { s: 48; t: 9 }; continueWith: { typeName: "s48-t10" } };
  "s48-t10": { input: { s: 48; t: 10 }; continueWith: { typeName: "s48-t11" } };
  "s48-t11": { input: { s: 48; t: 11 }; continueWith: { typeName: "s48-t12" } };
  "s48-t12": { input: { s: 48; t: 12 }; continueWith: { typeName: "s48-t13" } };
  "s48-t13": { input: { s: 48; t: 13 }; continueWith: { typeName: "s48-t14" } };
  "s48-t14": { input: { s: 48; t: 14 }; continueWith: { typeName: "s48-t15" } };
  "s48-t15": { input: { s: 48; t: 15 }; continueWith: { typeName: "s48-t16" } };
  "s48-t16": { input: { s: 48; t: 16 }; continueWith: { typeName: "s48-t17" } };
  "s48-t17": { input: { s: 48; t: 17 }; continueWith: { typeName: "s48-t18" } };
  "s48-t18": { input: { s: 48; t: 18 }; continueWith: { typeName: "s48-t19" } };
  "s48-t19": { input: { s: 48; t: 19 }; output: { s: 48; done: true } };
}>();

const slice49 = defineJobTypes<{
  "s49-t0": { entry: true; input: { s: 49; t: 0 }; continueWith: { typeName: "s49-t1" } };
  "s49-t1": { input: { s: 49; t: 1 }; continueWith: { typeName: "s49-t2" } };
  "s49-t2": { input: { s: 49; t: 2 }; continueWith: { typeName: "s49-t3" } };
  "s49-t3": { input: { s: 49; t: 3 }; continueWith: { typeName: "s49-t4" } };
  "s49-t4": { input: { s: 49; t: 4 }; continueWith: { typeName: "s49-t5" } };
  "s49-t5": { input: { s: 49; t: 5 }; continueWith: { typeName: "s49-t6" } };
  "s49-t6": { input: { s: 49; t: 6 }; continueWith: { typeName: "s49-t7" } };
  "s49-t7": { input: { s: 49; t: 7 }; continueWith: { typeName: "s49-t8" } };
  "s49-t8": { input: { s: 49; t: 8 }; continueWith: { typeName: "s49-t9" } };
  "s49-t9": { input: { s: 49; t: 9 }; continueWith: { typeName: "s49-t10" } };
  "s49-t10": { input: { s: 49; t: 10 }; continueWith: { typeName: "s49-t11" } };
  "s49-t11": { input: { s: 49; t: 11 }; continueWith: { typeName: "s49-t12" } };
  "s49-t12": { input: { s: 49; t: 12 }; continueWith: { typeName: "s49-t13" } };
  "s49-t13": { input: { s: 49; t: 13 }; continueWith: { typeName: "s49-t14" } };
  "s49-t14": { input: { s: 49; t: 14 }; continueWith: { typeName: "s49-t15" } };
  "s49-t15": { input: { s: 49; t: 15 }; continueWith: { typeName: "s49-t16" } };
  "s49-t16": { input: { s: 49; t: 16 }; continueWith: { typeName: "s49-t17" } };
  "s49-t17": { input: { s: 49; t: 17 }; continueWith: { typeName: "s49-t18" } };
  "s49-t18": { input: { s: 49; t: 18 }; continueWith: { typeName: "s49-t19" } };
  "s49-t19": { input: { s: 49; t: 19 }; output: { s: 49; done: true } };
}>();

const slice50 = defineJobTypes<{
  "s50-t0": { entry: true; input: { s: 50; t: 0 }; continueWith: { typeName: "s50-t1" } };
  "s50-t1": { input: { s: 50; t: 1 }; continueWith: { typeName: "s50-t2" } };
  "s50-t2": { input: { s: 50; t: 2 }; continueWith: { typeName: "s50-t3" } };
  "s50-t3": { input: { s: 50; t: 3 }; continueWith: { typeName: "s50-t4" } };
  "s50-t4": { input: { s: 50; t: 4 }; continueWith: { typeName: "s50-t5" } };
  "s50-t5": { input: { s: 50; t: 5 }; continueWith: { typeName: "s50-t6" } };
  "s50-t6": { input: { s: 50; t: 6 }; continueWith: { typeName: "s50-t7" } };
  "s50-t7": { input: { s: 50; t: 7 }; continueWith: { typeName: "s50-t8" } };
  "s50-t8": { input: { s: 50; t: 8 }; continueWith: { typeName: "s50-t9" } };
  "s50-t9": { input: { s: 50; t: 9 }; continueWith: { typeName: "s50-t10" } };
  "s50-t10": { input: { s: 50; t: 10 }; continueWith: { typeName: "s50-t11" } };
  "s50-t11": { input: { s: 50; t: 11 }; continueWith: { typeName: "s50-t12" } };
  "s50-t12": { input: { s: 50; t: 12 }; continueWith: { typeName: "s50-t13" } };
  "s50-t13": { input: { s: 50; t: 13 }; continueWith: { typeName: "s50-t14" } };
  "s50-t14": { input: { s: 50; t: 14 }; continueWith: { typeName: "s50-t15" } };
  "s50-t15": { input: { s: 50; t: 15 }; continueWith: { typeName: "s50-t16" } };
  "s50-t16": { input: { s: 50; t: 16 }; continueWith: { typeName: "s50-t17" } };
  "s50-t17": { input: { s: 50; t: 17 }; continueWith: { typeName: "s50-t18" } };
  "s50-t18": { input: { s: 50; t: 18 }; continueWith: { typeName: "s50-t19" } };
  "s50-t19": { input: { s: 50; t: 19 }; output: { s: 50; done: true } };
}>();

const slice51 = defineJobTypes<{
  "s51-t0": { entry: true; input: { s: 51; t: 0 }; continueWith: { typeName: "s51-t1" } };
  "s51-t1": { input: { s: 51; t: 1 }; continueWith: { typeName: "s51-t2" } };
  "s51-t2": { input: { s: 51; t: 2 }; continueWith: { typeName: "s51-t3" } };
  "s51-t3": { input: { s: 51; t: 3 }; continueWith: { typeName: "s51-t4" } };
  "s51-t4": { input: { s: 51; t: 4 }; continueWith: { typeName: "s51-t5" } };
  "s51-t5": { input: { s: 51; t: 5 }; continueWith: { typeName: "s51-t6" } };
  "s51-t6": { input: { s: 51; t: 6 }; continueWith: { typeName: "s51-t7" } };
  "s51-t7": { input: { s: 51; t: 7 }; continueWith: { typeName: "s51-t8" } };
  "s51-t8": { input: { s: 51; t: 8 }; continueWith: { typeName: "s51-t9" } };
  "s51-t9": { input: { s: 51; t: 9 }; continueWith: { typeName: "s51-t10" } };
  "s51-t10": { input: { s: 51; t: 10 }; continueWith: { typeName: "s51-t11" } };
  "s51-t11": { input: { s: 51; t: 11 }; continueWith: { typeName: "s51-t12" } };
  "s51-t12": { input: { s: 51; t: 12 }; continueWith: { typeName: "s51-t13" } };
  "s51-t13": { input: { s: 51; t: 13 }; continueWith: { typeName: "s51-t14" } };
  "s51-t14": { input: { s: 51; t: 14 }; continueWith: { typeName: "s51-t15" } };
  "s51-t15": { input: { s: 51; t: 15 }; continueWith: { typeName: "s51-t16" } };
  "s51-t16": { input: { s: 51; t: 16 }; continueWith: { typeName: "s51-t17" } };
  "s51-t17": { input: { s: 51; t: 17 }; continueWith: { typeName: "s51-t18" } };
  "s51-t18": { input: { s: 51; t: 18 }; continueWith: { typeName: "s51-t19" } };
  "s51-t19": { input: { s: 51; t: 19 }; output: { s: 51; done: true } };
}>();

const slice52 = defineJobTypes<{
  "s52-t0": { entry: true; input: { s: 52; t: 0 }; continueWith: { typeName: "s52-t1" } };
  "s52-t1": { input: { s: 52; t: 1 }; continueWith: { typeName: "s52-t2" } };
  "s52-t2": { input: { s: 52; t: 2 }; continueWith: { typeName: "s52-t3" } };
  "s52-t3": { input: { s: 52; t: 3 }; continueWith: { typeName: "s52-t4" } };
  "s52-t4": { input: { s: 52; t: 4 }; continueWith: { typeName: "s52-t5" } };
  "s52-t5": { input: { s: 52; t: 5 }; continueWith: { typeName: "s52-t6" } };
  "s52-t6": { input: { s: 52; t: 6 }; continueWith: { typeName: "s52-t7" } };
  "s52-t7": { input: { s: 52; t: 7 }; continueWith: { typeName: "s52-t8" } };
  "s52-t8": { input: { s: 52; t: 8 }; continueWith: { typeName: "s52-t9" } };
  "s52-t9": { input: { s: 52; t: 9 }; continueWith: { typeName: "s52-t10" } };
  "s52-t10": { input: { s: 52; t: 10 }; continueWith: { typeName: "s52-t11" } };
  "s52-t11": { input: { s: 52; t: 11 }; continueWith: { typeName: "s52-t12" } };
  "s52-t12": { input: { s: 52; t: 12 }; continueWith: { typeName: "s52-t13" } };
  "s52-t13": { input: { s: 52; t: 13 }; continueWith: { typeName: "s52-t14" } };
  "s52-t14": { input: { s: 52; t: 14 }; continueWith: { typeName: "s52-t15" } };
  "s52-t15": { input: { s: 52; t: 15 }; continueWith: { typeName: "s52-t16" } };
  "s52-t16": { input: { s: 52; t: 16 }; continueWith: { typeName: "s52-t17" } };
  "s52-t17": { input: { s: 52; t: 17 }; continueWith: { typeName: "s52-t18" } };
  "s52-t18": { input: { s: 52; t: 18 }; continueWith: { typeName: "s52-t19" } };
  "s52-t19": { input: { s: 52; t: 19 }; output: { s: 52; done: true } };
}>();

const slice53 = defineJobTypes<{
  "s53-t0": { entry: true; input: { s: 53; t: 0 }; continueWith: { typeName: "s53-t1" } };
  "s53-t1": { input: { s: 53; t: 1 }; continueWith: { typeName: "s53-t2" } };
  "s53-t2": { input: { s: 53; t: 2 }; continueWith: { typeName: "s53-t3" } };
  "s53-t3": { input: { s: 53; t: 3 }; continueWith: { typeName: "s53-t4" } };
  "s53-t4": { input: { s: 53; t: 4 }; continueWith: { typeName: "s53-t5" } };
  "s53-t5": { input: { s: 53; t: 5 }; continueWith: { typeName: "s53-t6" } };
  "s53-t6": { input: { s: 53; t: 6 }; continueWith: { typeName: "s53-t7" } };
  "s53-t7": { input: { s: 53; t: 7 }; continueWith: { typeName: "s53-t8" } };
  "s53-t8": { input: { s: 53; t: 8 }; continueWith: { typeName: "s53-t9" } };
  "s53-t9": { input: { s: 53; t: 9 }; continueWith: { typeName: "s53-t10" } };
  "s53-t10": { input: { s: 53; t: 10 }; continueWith: { typeName: "s53-t11" } };
  "s53-t11": { input: { s: 53; t: 11 }; continueWith: { typeName: "s53-t12" } };
  "s53-t12": { input: { s: 53; t: 12 }; continueWith: { typeName: "s53-t13" } };
  "s53-t13": { input: { s: 53; t: 13 }; continueWith: { typeName: "s53-t14" } };
  "s53-t14": { input: { s: 53; t: 14 }; continueWith: { typeName: "s53-t15" } };
  "s53-t15": { input: { s: 53; t: 15 }; continueWith: { typeName: "s53-t16" } };
  "s53-t16": { input: { s: 53; t: 16 }; continueWith: { typeName: "s53-t17" } };
  "s53-t17": { input: { s: 53; t: 17 }; continueWith: { typeName: "s53-t18" } };
  "s53-t18": { input: { s: 53; t: 18 }; continueWith: { typeName: "s53-t19" } };
  "s53-t19": { input: { s: 53; t: 19 }; output: { s: 53; done: true } };
}>();

const slice54 = defineJobTypes<{
  "s54-t0": { entry: true; input: { s: 54; t: 0 }; continueWith: { typeName: "s54-t1" } };
  "s54-t1": { input: { s: 54; t: 1 }; continueWith: { typeName: "s54-t2" } };
  "s54-t2": { input: { s: 54; t: 2 }; continueWith: { typeName: "s54-t3" } };
  "s54-t3": { input: { s: 54; t: 3 }; continueWith: { typeName: "s54-t4" } };
  "s54-t4": { input: { s: 54; t: 4 }; continueWith: { typeName: "s54-t5" } };
  "s54-t5": { input: { s: 54; t: 5 }; continueWith: { typeName: "s54-t6" } };
  "s54-t6": { input: { s: 54; t: 6 }; continueWith: { typeName: "s54-t7" } };
  "s54-t7": { input: { s: 54; t: 7 }; continueWith: { typeName: "s54-t8" } };
  "s54-t8": { input: { s: 54; t: 8 }; continueWith: { typeName: "s54-t9" } };
  "s54-t9": { input: { s: 54; t: 9 }; continueWith: { typeName: "s54-t10" } };
  "s54-t10": { input: { s: 54; t: 10 }; continueWith: { typeName: "s54-t11" } };
  "s54-t11": { input: { s: 54; t: 11 }; continueWith: { typeName: "s54-t12" } };
  "s54-t12": { input: { s: 54; t: 12 }; continueWith: { typeName: "s54-t13" } };
  "s54-t13": { input: { s: 54; t: 13 }; continueWith: { typeName: "s54-t14" } };
  "s54-t14": { input: { s: 54; t: 14 }; continueWith: { typeName: "s54-t15" } };
  "s54-t15": { input: { s: 54; t: 15 }; continueWith: { typeName: "s54-t16" } };
  "s54-t16": { input: { s: 54; t: 16 }; continueWith: { typeName: "s54-t17" } };
  "s54-t17": { input: { s: 54; t: 17 }; continueWith: { typeName: "s54-t18" } };
  "s54-t18": { input: { s: 54; t: 18 }; continueWith: { typeName: "s54-t19" } };
  "s54-t19": { input: { s: 54; t: 19 }; output: { s: 54; done: true } };
}>();

const slice55 = defineJobTypes<{
  "s55-t0": { entry: true; input: { s: 55; t: 0 }; continueWith: { typeName: "s55-t1" } };
  "s55-t1": { input: { s: 55; t: 1 }; continueWith: { typeName: "s55-t2" } };
  "s55-t2": { input: { s: 55; t: 2 }; continueWith: { typeName: "s55-t3" } };
  "s55-t3": { input: { s: 55; t: 3 }; continueWith: { typeName: "s55-t4" } };
  "s55-t4": { input: { s: 55; t: 4 }; continueWith: { typeName: "s55-t5" } };
  "s55-t5": { input: { s: 55; t: 5 }; continueWith: { typeName: "s55-t6" } };
  "s55-t6": { input: { s: 55; t: 6 }; continueWith: { typeName: "s55-t7" } };
  "s55-t7": { input: { s: 55; t: 7 }; continueWith: { typeName: "s55-t8" } };
  "s55-t8": { input: { s: 55; t: 8 }; continueWith: { typeName: "s55-t9" } };
  "s55-t9": { input: { s: 55; t: 9 }; continueWith: { typeName: "s55-t10" } };
  "s55-t10": { input: { s: 55; t: 10 }; continueWith: { typeName: "s55-t11" } };
  "s55-t11": { input: { s: 55; t: 11 }; continueWith: { typeName: "s55-t12" } };
  "s55-t12": { input: { s: 55; t: 12 }; continueWith: { typeName: "s55-t13" } };
  "s55-t13": { input: { s: 55; t: 13 }; continueWith: { typeName: "s55-t14" } };
  "s55-t14": { input: { s: 55; t: 14 }; continueWith: { typeName: "s55-t15" } };
  "s55-t15": { input: { s: 55; t: 15 }; continueWith: { typeName: "s55-t16" } };
  "s55-t16": { input: { s: 55; t: 16 }; continueWith: { typeName: "s55-t17" } };
  "s55-t17": { input: { s: 55; t: 17 }; continueWith: { typeName: "s55-t18" } };
  "s55-t18": { input: { s: 55; t: 18 }; continueWith: { typeName: "s55-t19" } };
  "s55-t19": { input: { s: 55; t: 19 }; output: { s: 55; done: true } };
}>();

const slice56 = defineJobTypes<{
  "s56-t0": { entry: true; input: { s: 56; t: 0 }; continueWith: { typeName: "s56-t1" } };
  "s56-t1": { input: { s: 56; t: 1 }; continueWith: { typeName: "s56-t2" } };
  "s56-t2": { input: { s: 56; t: 2 }; continueWith: { typeName: "s56-t3" } };
  "s56-t3": { input: { s: 56; t: 3 }; continueWith: { typeName: "s56-t4" } };
  "s56-t4": { input: { s: 56; t: 4 }; continueWith: { typeName: "s56-t5" } };
  "s56-t5": { input: { s: 56; t: 5 }; continueWith: { typeName: "s56-t6" } };
  "s56-t6": { input: { s: 56; t: 6 }; continueWith: { typeName: "s56-t7" } };
  "s56-t7": { input: { s: 56; t: 7 }; continueWith: { typeName: "s56-t8" } };
  "s56-t8": { input: { s: 56; t: 8 }; continueWith: { typeName: "s56-t9" } };
  "s56-t9": { input: { s: 56; t: 9 }; continueWith: { typeName: "s56-t10" } };
  "s56-t10": { input: { s: 56; t: 10 }; continueWith: { typeName: "s56-t11" } };
  "s56-t11": { input: { s: 56; t: 11 }; continueWith: { typeName: "s56-t12" } };
  "s56-t12": { input: { s: 56; t: 12 }; continueWith: { typeName: "s56-t13" } };
  "s56-t13": { input: { s: 56; t: 13 }; continueWith: { typeName: "s56-t14" } };
  "s56-t14": { input: { s: 56; t: 14 }; continueWith: { typeName: "s56-t15" } };
  "s56-t15": { input: { s: 56; t: 15 }; continueWith: { typeName: "s56-t16" } };
  "s56-t16": { input: { s: 56; t: 16 }; continueWith: { typeName: "s56-t17" } };
  "s56-t17": { input: { s: 56; t: 17 }; continueWith: { typeName: "s56-t18" } };
  "s56-t18": { input: { s: 56; t: 18 }; continueWith: { typeName: "s56-t19" } };
  "s56-t19": { input: { s: 56; t: 19 }; output: { s: 56; done: true } };
}>();

const slice57 = defineJobTypes<{
  "s57-t0": { entry: true; input: { s: 57; t: 0 }; continueWith: { typeName: "s57-t1" } };
  "s57-t1": { input: { s: 57; t: 1 }; continueWith: { typeName: "s57-t2" } };
  "s57-t2": { input: { s: 57; t: 2 }; continueWith: { typeName: "s57-t3" } };
  "s57-t3": { input: { s: 57; t: 3 }; continueWith: { typeName: "s57-t4" } };
  "s57-t4": { input: { s: 57; t: 4 }; continueWith: { typeName: "s57-t5" } };
  "s57-t5": { input: { s: 57; t: 5 }; continueWith: { typeName: "s57-t6" } };
  "s57-t6": { input: { s: 57; t: 6 }; continueWith: { typeName: "s57-t7" } };
  "s57-t7": { input: { s: 57; t: 7 }; continueWith: { typeName: "s57-t8" } };
  "s57-t8": { input: { s: 57; t: 8 }; continueWith: { typeName: "s57-t9" } };
  "s57-t9": { input: { s: 57; t: 9 }; continueWith: { typeName: "s57-t10" } };
  "s57-t10": { input: { s: 57; t: 10 }; continueWith: { typeName: "s57-t11" } };
  "s57-t11": { input: { s: 57; t: 11 }; continueWith: { typeName: "s57-t12" } };
  "s57-t12": { input: { s: 57; t: 12 }; continueWith: { typeName: "s57-t13" } };
  "s57-t13": { input: { s: 57; t: 13 }; continueWith: { typeName: "s57-t14" } };
  "s57-t14": { input: { s: 57; t: 14 }; continueWith: { typeName: "s57-t15" } };
  "s57-t15": { input: { s: 57; t: 15 }; continueWith: { typeName: "s57-t16" } };
  "s57-t16": { input: { s: 57; t: 16 }; continueWith: { typeName: "s57-t17" } };
  "s57-t17": { input: { s: 57; t: 17 }; continueWith: { typeName: "s57-t18" } };
  "s57-t18": { input: { s: 57; t: 18 }; continueWith: { typeName: "s57-t19" } };
  "s57-t19": { input: { s: 57; t: 19 }; output: { s: 57; done: true } };
}>();

const slice58 = defineJobTypes<{
  "s58-t0": { entry: true; input: { s: 58; t: 0 }; continueWith: { typeName: "s58-t1" } };
  "s58-t1": { input: { s: 58; t: 1 }; continueWith: { typeName: "s58-t2" } };
  "s58-t2": { input: { s: 58; t: 2 }; continueWith: { typeName: "s58-t3" } };
  "s58-t3": { input: { s: 58; t: 3 }; continueWith: { typeName: "s58-t4" } };
  "s58-t4": { input: { s: 58; t: 4 }; continueWith: { typeName: "s58-t5" } };
  "s58-t5": { input: { s: 58; t: 5 }; continueWith: { typeName: "s58-t6" } };
  "s58-t6": { input: { s: 58; t: 6 }; continueWith: { typeName: "s58-t7" } };
  "s58-t7": { input: { s: 58; t: 7 }; continueWith: { typeName: "s58-t8" } };
  "s58-t8": { input: { s: 58; t: 8 }; continueWith: { typeName: "s58-t9" } };
  "s58-t9": { input: { s: 58; t: 9 }; continueWith: { typeName: "s58-t10" } };
  "s58-t10": { input: { s: 58; t: 10 }; continueWith: { typeName: "s58-t11" } };
  "s58-t11": { input: { s: 58; t: 11 }; continueWith: { typeName: "s58-t12" } };
  "s58-t12": { input: { s: 58; t: 12 }; continueWith: { typeName: "s58-t13" } };
  "s58-t13": { input: { s: 58; t: 13 }; continueWith: { typeName: "s58-t14" } };
  "s58-t14": { input: { s: 58; t: 14 }; continueWith: { typeName: "s58-t15" } };
  "s58-t15": { input: { s: 58; t: 15 }; continueWith: { typeName: "s58-t16" } };
  "s58-t16": { input: { s: 58; t: 16 }; continueWith: { typeName: "s58-t17" } };
  "s58-t17": { input: { s: 58; t: 17 }; continueWith: { typeName: "s58-t18" } };
  "s58-t18": { input: { s: 58; t: 18 }; continueWith: { typeName: "s58-t19" } };
  "s58-t19": { input: { s: 58; t: 19 }; output: { s: 58; done: true } };
}>();

const slice59 = defineJobTypes<{
  "s59-t0": { entry: true; input: { s: 59; t: 0 }; continueWith: { typeName: "s59-t1" } };
  "s59-t1": { input: { s: 59; t: 1 }; continueWith: { typeName: "s59-t2" } };
  "s59-t2": { input: { s: 59; t: 2 }; continueWith: { typeName: "s59-t3" } };
  "s59-t3": { input: { s: 59; t: 3 }; continueWith: { typeName: "s59-t4" } };
  "s59-t4": { input: { s: 59; t: 4 }; continueWith: { typeName: "s59-t5" } };
  "s59-t5": { input: { s: 59; t: 5 }; continueWith: { typeName: "s59-t6" } };
  "s59-t6": { input: { s: 59; t: 6 }; continueWith: { typeName: "s59-t7" } };
  "s59-t7": { input: { s: 59; t: 7 }; continueWith: { typeName: "s59-t8" } };
  "s59-t8": { input: { s: 59; t: 8 }; continueWith: { typeName: "s59-t9" } };
  "s59-t9": { input: { s: 59; t: 9 }; continueWith: { typeName: "s59-t10" } };
  "s59-t10": { input: { s: 59; t: 10 }; continueWith: { typeName: "s59-t11" } };
  "s59-t11": { input: { s: 59; t: 11 }; continueWith: { typeName: "s59-t12" } };
  "s59-t12": { input: { s: 59; t: 12 }; continueWith: { typeName: "s59-t13" } };
  "s59-t13": { input: { s: 59; t: 13 }; continueWith: { typeName: "s59-t14" } };
  "s59-t14": { input: { s: 59; t: 14 }; continueWith: { typeName: "s59-t15" } };
  "s59-t15": { input: { s: 59; t: 15 }; continueWith: { typeName: "s59-t16" } };
  "s59-t16": { input: { s: 59; t: 16 }; continueWith: { typeName: "s59-t17" } };
  "s59-t17": { input: { s: 59; t: 17 }; continueWith: { typeName: "s59-t18" } };
  "s59-t18": { input: { s: 59; t: 18 }; continueWith: { typeName: "s59-t19" } };
  "s59-t19": { input: { s: 59; t: 19 }; output: { s: 59; done: true } };
}>();

const slice60 = defineJobTypes<{
  "s60-t0": { entry: true; input: { s: 60; t: 0 }; continueWith: { typeName: "s60-t1" } };
  "s60-t1": { input: { s: 60; t: 1 }; continueWith: { typeName: "s60-t2" } };
  "s60-t2": { input: { s: 60; t: 2 }; continueWith: { typeName: "s60-t3" } };
  "s60-t3": { input: { s: 60; t: 3 }; continueWith: { typeName: "s60-t4" } };
  "s60-t4": { input: { s: 60; t: 4 }; continueWith: { typeName: "s60-t5" } };
  "s60-t5": { input: { s: 60; t: 5 }; continueWith: { typeName: "s60-t6" } };
  "s60-t6": { input: { s: 60; t: 6 }; continueWith: { typeName: "s60-t7" } };
  "s60-t7": { input: { s: 60; t: 7 }; continueWith: { typeName: "s60-t8" } };
  "s60-t8": { input: { s: 60; t: 8 }; continueWith: { typeName: "s60-t9" } };
  "s60-t9": { input: { s: 60; t: 9 }; continueWith: { typeName: "s60-t10" } };
  "s60-t10": { input: { s: 60; t: 10 }; continueWith: { typeName: "s60-t11" } };
  "s60-t11": { input: { s: 60; t: 11 }; continueWith: { typeName: "s60-t12" } };
  "s60-t12": { input: { s: 60; t: 12 }; continueWith: { typeName: "s60-t13" } };
  "s60-t13": { input: { s: 60; t: 13 }; continueWith: { typeName: "s60-t14" } };
  "s60-t14": { input: { s: 60; t: 14 }; continueWith: { typeName: "s60-t15" } };
  "s60-t15": { input: { s: 60; t: 15 }; continueWith: { typeName: "s60-t16" } };
  "s60-t16": { input: { s: 60; t: 16 }; continueWith: { typeName: "s60-t17" } };
  "s60-t17": { input: { s: 60; t: 17 }; continueWith: { typeName: "s60-t18" } };
  "s60-t18": { input: { s: 60; t: 18 }; continueWith: { typeName: "s60-t19" } };
  "s60-t19": { input: { s: 60; t: 19 }; output: { s: 60; done: true } };
}>();

const slice61 = defineJobTypes<{
  "s61-t0": { entry: true; input: { s: 61; t: 0 }; continueWith: { typeName: "s61-t1" } };
  "s61-t1": { input: { s: 61; t: 1 }; continueWith: { typeName: "s61-t2" } };
  "s61-t2": { input: { s: 61; t: 2 }; continueWith: { typeName: "s61-t3" } };
  "s61-t3": { input: { s: 61; t: 3 }; continueWith: { typeName: "s61-t4" } };
  "s61-t4": { input: { s: 61; t: 4 }; continueWith: { typeName: "s61-t5" } };
  "s61-t5": { input: { s: 61; t: 5 }; continueWith: { typeName: "s61-t6" } };
  "s61-t6": { input: { s: 61; t: 6 }; continueWith: { typeName: "s61-t7" } };
  "s61-t7": { input: { s: 61; t: 7 }; continueWith: { typeName: "s61-t8" } };
  "s61-t8": { input: { s: 61; t: 8 }; continueWith: { typeName: "s61-t9" } };
  "s61-t9": { input: { s: 61; t: 9 }; continueWith: { typeName: "s61-t10" } };
  "s61-t10": { input: { s: 61; t: 10 }; continueWith: { typeName: "s61-t11" } };
  "s61-t11": { input: { s: 61; t: 11 }; continueWith: { typeName: "s61-t12" } };
  "s61-t12": { input: { s: 61; t: 12 }; continueWith: { typeName: "s61-t13" } };
  "s61-t13": { input: { s: 61; t: 13 }; continueWith: { typeName: "s61-t14" } };
  "s61-t14": { input: { s: 61; t: 14 }; continueWith: { typeName: "s61-t15" } };
  "s61-t15": { input: { s: 61; t: 15 }; continueWith: { typeName: "s61-t16" } };
  "s61-t16": { input: { s: 61; t: 16 }; continueWith: { typeName: "s61-t17" } };
  "s61-t17": { input: { s: 61; t: 17 }; continueWith: { typeName: "s61-t18" } };
  "s61-t18": { input: { s: 61; t: 18 }; continueWith: { typeName: "s61-t19" } };
  "s61-t19": { input: { s: 61; t: 19 }; output: { s: 61; done: true } };
}>();

const slice62 = defineJobTypes<{
  "s62-t0": { entry: true; input: { s: 62; t: 0 }; continueWith: { typeName: "s62-t1" } };
  "s62-t1": { input: { s: 62; t: 1 }; continueWith: { typeName: "s62-t2" } };
  "s62-t2": { input: { s: 62; t: 2 }; continueWith: { typeName: "s62-t3" } };
  "s62-t3": { input: { s: 62; t: 3 }; continueWith: { typeName: "s62-t4" } };
  "s62-t4": { input: { s: 62; t: 4 }; continueWith: { typeName: "s62-t5" } };
  "s62-t5": { input: { s: 62; t: 5 }; continueWith: { typeName: "s62-t6" } };
  "s62-t6": { input: { s: 62; t: 6 }; continueWith: { typeName: "s62-t7" } };
  "s62-t7": { input: { s: 62; t: 7 }; continueWith: { typeName: "s62-t8" } };
  "s62-t8": { input: { s: 62; t: 8 }; continueWith: { typeName: "s62-t9" } };
  "s62-t9": { input: { s: 62; t: 9 }; continueWith: { typeName: "s62-t10" } };
  "s62-t10": { input: { s: 62; t: 10 }; continueWith: { typeName: "s62-t11" } };
  "s62-t11": { input: { s: 62; t: 11 }; continueWith: { typeName: "s62-t12" } };
  "s62-t12": { input: { s: 62; t: 12 }; continueWith: { typeName: "s62-t13" } };
  "s62-t13": { input: { s: 62; t: 13 }; continueWith: { typeName: "s62-t14" } };
  "s62-t14": { input: { s: 62; t: 14 }; continueWith: { typeName: "s62-t15" } };
  "s62-t15": { input: { s: 62; t: 15 }; continueWith: { typeName: "s62-t16" } };
  "s62-t16": { input: { s: 62; t: 16 }; continueWith: { typeName: "s62-t17" } };
  "s62-t17": { input: { s: 62; t: 17 }; continueWith: { typeName: "s62-t18" } };
  "s62-t18": { input: { s: 62; t: 18 }; continueWith: { typeName: "s62-t19" } };
  "s62-t19": { input: { s: 62; t: 19 }; output: { s: 62; done: true } };
}>();

const slice63 = defineJobTypes<{
  "s63-t0": { entry: true; input: { s: 63; t: 0 }; continueWith: { typeName: "s63-t1" } };
  "s63-t1": { input: { s: 63; t: 1 }; continueWith: { typeName: "s63-t2" } };
  "s63-t2": { input: { s: 63; t: 2 }; continueWith: { typeName: "s63-t3" } };
  "s63-t3": { input: { s: 63; t: 3 }; continueWith: { typeName: "s63-t4" } };
  "s63-t4": { input: { s: 63; t: 4 }; continueWith: { typeName: "s63-t5" } };
  "s63-t5": { input: { s: 63; t: 5 }; continueWith: { typeName: "s63-t6" } };
  "s63-t6": { input: { s: 63; t: 6 }; continueWith: { typeName: "s63-t7" } };
  "s63-t7": { input: { s: 63; t: 7 }; continueWith: { typeName: "s63-t8" } };
  "s63-t8": { input: { s: 63; t: 8 }; continueWith: { typeName: "s63-t9" } };
  "s63-t9": { input: { s: 63; t: 9 }; continueWith: { typeName: "s63-t10" } };
  "s63-t10": { input: { s: 63; t: 10 }; continueWith: { typeName: "s63-t11" } };
  "s63-t11": { input: { s: 63; t: 11 }; continueWith: { typeName: "s63-t12" } };
  "s63-t12": { input: { s: 63; t: 12 }; continueWith: { typeName: "s63-t13" } };
  "s63-t13": { input: { s: 63; t: 13 }; continueWith: { typeName: "s63-t14" } };
  "s63-t14": { input: { s: 63; t: 14 }; continueWith: { typeName: "s63-t15" } };
  "s63-t15": { input: { s: 63; t: 15 }; continueWith: { typeName: "s63-t16" } };
  "s63-t16": { input: { s: 63; t: 16 }; continueWith: { typeName: "s63-t17" } };
  "s63-t17": { input: { s: 63; t: 17 }; continueWith: { typeName: "s63-t18" } };
  "s63-t18": { input: { s: 63; t: 18 }; continueWith: { typeName: "s63-t19" } };
  "s63-t19": { input: { s: 63; t: 19 }; output: { s: 63; done: true } };
}>();

const slice64 = defineJobTypes<{
  "s64-t0": { entry: true; input: { s: 64; t: 0 }; continueWith: { typeName: "s64-t1" } };
  "s64-t1": { input: { s: 64; t: 1 }; continueWith: { typeName: "s64-t2" } };
  "s64-t2": { input: { s: 64; t: 2 }; continueWith: { typeName: "s64-t3" } };
  "s64-t3": { input: { s: 64; t: 3 }; continueWith: { typeName: "s64-t4" } };
  "s64-t4": { input: { s: 64; t: 4 }; continueWith: { typeName: "s64-t5" } };
  "s64-t5": { input: { s: 64; t: 5 }; continueWith: { typeName: "s64-t6" } };
  "s64-t6": { input: { s: 64; t: 6 }; continueWith: { typeName: "s64-t7" } };
  "s64-t7": { input: { s: 64; t: 7 }; continueWith: { typeName: "s64-t8" } };
  "s64-t8": { input: { s: 64; t: 8 }; continueWith: { typeName: "s64-t9" } };
  "s64-t9": { input: { s: 64; t: 9 }; continueWith: { typeName: "s64-t10" } };
  "s64-t10": { input: { s: 64; t: 10 }; continueWith: { typeName: "s64-t11" } };
  "s64-t11": { input: { s: 64; t: 11 }; continueWith: { typeName: "s64-t12" } };
  "s64-t12": { input: { s: 64; t: 12 }; continueWith: { typeName: "s64-t13" } };
  "s64-t13": { input: { s: 64; t: 13 }; continueWith: { typeName: "s64-t14" } };
  "s64-t14": { input: { s: 64; t: 14 }; continueWith: { typeName: "s64-t15" } };
  "s64-t15": { input: { s: 64; t: 15 }; continueWith: { typeName: "s64-t16" } };
  "s64-t16": { input: { s: 64; t: 16 }; continueWith: { typeName: "s64-t17" } };
  "s64-t17": { input: { s: 64; t: 17 }; continueWith: { typeName: "s64-t18" } };
  "s64-t18": { input: { s: 64; t: 18 }; continueWith: { typeName: "s64-t19" } };
  "s64-t19": { input: { s: 64; t: 19 }; output: { s: 64; done: true } };
}>();

const slice65 = defineJobTypes<{
  "s65-t0": { entry: true; input: { s: 65; t: 0 }; continueWith: { typeName: "s65-t1" } };
  "s65-t1": { input: { s: 65; t: 1 }; continueWith: { typeName: "s65-t2" } };
  "s65-t2": { input: { s: 65; t: 2 }; continueWith: { typeName: "s65-t3" } };
  "s65-t3": { input: { s: 65; t: 3 }; continueWith: { typeName: "s65-t4" } };
  "s65-t4": { input: { s: 65; t: 4 }; continueWith: { typeName: "s65-t5" } };
  "s65-t5": { input: { s: 65; t: 5 }; continueWith: { typeName: "s65-t6" } };
  "s65-t6": { input: { s: 65; t: 6 }; continueWith: { typeName: "s65-t7" } };
  "s65-t7": { input: { s: 65; t: 7 }; continueWith: { typeName: "s65-t8" } };
  "s65-t8": { input: { s: 65; t: 8 }; continueWith: { typeName: "s65-t9" } };
  "s65-t9": { input: { s: 65; t: 9 }; continueWith: { typeName: "s65-t10" } };
  "s65-t10": { input: { s: 65; t: 10 }; continueWith: { typeName: "s65-t11" } };
  "s65-t11": { input: { s: 65; t: 11 }; continueWith: { typeName: "s65-t12" } };
  "s65-t12": { input: { s: 65; t: 12 }; continueWith: { typeName: "s65-t13" } };
  "s65-t13": { input: { s: 65; t: 13 }; continueWith: { typeName: "s65-t14" } };
  "s65-t14": { input: { s: 65; t: 14 }; continueWith: { typeName: "s65-t15" } };
  "s65-t15": { input: { s: 65; t: 15 }; continueWith: { typeName: "s65-t16" } };
  "s65-t16": { input: { s: 65; t: 16 }; continueWith: { typeName: "s65-t17" } };
  "s65-t17": { input: { s: 65; t: 17 }; continueWith: { typeName: "s65-t18" } };
  "s65-t18": { input: { s: 65; t: 18 }; continueWith: { typeName: "s65-t19" } };
  "s65-t19": { input: { s: 65; t: 19 }; output: { s: 65; done: true } };
}>();

const slice66 = defineJobTypes<{
  "s66-t0": { entry: true; input: { s: 66; t: 0 }; continueWith: { typeName: "s66-t1" } };
  "s66-t1": { input: { s: 66; t: 1 }; continueWith: { typeName: "s66-t2" } };
  "s66-t2": { input: { s: 66; t: 2 }; continueWith: { typeName: "s66-t3" } };
  "s66-t3": { input: { s: 66; t: 3 }; continueWith: { typeName: "s66-t4" } };
  "s66-t4": { input: { s: 66; t: 4 }; continueWith: { typeName: "s66-t5" } };
  "s66-t5": { input: { s: 66; t: 5 }; continueWith: { typeName: "s66-t6" } };
  "s66-t6": { input: { s: 66; t: 6 }; continueWith: { typeName: "s66-t7" } };
  "s66-t7": { input: { s: 66; t: 7 }; continueWith: { typeName: "s66-t8" } };
  "s66-t8": { input: { s: 66; t: 8 }; continueWith: { typeName: "s66-t9" } };
  "s66-t9": { input: { s: 66; t: 9 }; continueWith: { typeName: "s66-t10" } };
  "s66-t10": { input: { s: 66; t: 10 }; continueWith: { typeName: "s66-t11" } };
  "s66-t11": { input: { s: 66; t: 11 }; continueWith: { typeName: "s66-t12" } };
  "s66-t12": { input: { s: 66; t: 12 }; continueWith: { typeName: "s66-t13" } };
  "s66-t13": { input: { s: 66; t: 13 }; continueWith: { typeName: "s66-t14" } };
  "s66-t14": { input: { s: 66; t: 14 }; continueWith: { typeName: "s66-t15" } };
  "s66-t15": { input: { s: 66; t: 15 }; continueWith: { typeName: "s66-t16" } };
  "s66-t16": { input: { s: 66; t: 16 }; continueWith: { typeName: "s66-t17" } };
  "s66-t17": { input: { s: 66; t: 17 }; continueWith: { typeName: "s66-t18" } };
  "s66-t18": { input: { s: 66; t: 18 }; continueWith: { typeName: "s66-t19" } };
  "s66-t19": { input: { s: 66; t: 19 }; output: { s: 66; done: true } };
}>();

const slice67 = defineJobTypes<{
  "s67-t0": { entry: true; input: { s: 67; t: 0 }; continueWith: { typeName: "s67-t1" } };
  "s67-t1": { input: { s: 67; t: 1 }; continueWith: { typeName: "s67-t2" } };
  "s67-t2": { input: { s: 67; t: 2 }; continueWith: { typeName: "s67-t3" } };
  "s67-t3": { input: { s: 67; t: 3 }; continueWith: { typeName: "s67-t4" } };
  "s67-t4": { input: { s: 67; t: 4 }; continueWith: { typeName: "s67-t5" } };
  "s67-t5": { input: { s: 67; t: 5 }; continueWith: { typeName: "s67-t6" } };
  "s67-t6": { input: { s: 67; t: 6 }; continueWith: { typeName: "s67-t7" } };
  "s67-t7": { input: { s: 67; t: 7 }; continueWith: { typeName: "s67-t8" } };
  "s67-t8": { input: { s: 67; t: 8 }; continueWith: { typeName: "s67-t9" } };
  "s67-t9": { input: { s: 67; t: 9 }; continueWith: { typeName: "s67-t10" } };
  "s67-t10": { input: { s: 67; t: 10 }; continueWith: { typeName: "s67-t11" } };
  "s67-t11": { input: { s: 67; t: 11 }; continueWith: { typeName: "s67-t12" } };
  "s67-t12": { input: { s: 67; t: 12 }; continueWith: { typeName: "s67-t13" } };
  "s67-t13": { input: { s: 67; t: 13 }; continueWith: { typeName: "s67-t14" } };
  "s67-t14": { input: { s: 67; t: 14 }; continueWith: { typeName: "s67-t15" } };
  "s67-t15": { input: { s: 67; t: 15 }; continueWith: { typeName: "s67-t16" } };
  "s67-t16": { input: { s: 67; t: 16 }; continueWith: { typeName: "s67-t17" } };
  "s67-t17": { input: { s: 67; t: 17 }; continueWith: { typeName: "s67-t18" } };
  "s67-t18": { input: { s: 67; t: 18 }; continueWith: { typeName: "s67-t19" } };
  "s67-t19": { input: { s: 67; t: 19 }; output: { s: 67; done: true } };
}>();

const slice68 = defineJobTypes<{
  "s68-t0": { entry: true; input: { s: 68; t: 0 }; continueWith: { typeName: "s68-t1" } };
  "s68-t1": { input: { s: 68; t: 1 }; continueWith: { typeName: "s68-t2" } };
  "s68-t2": { input: { s: 68; t: 2 }; continueWith: { typeName: "s68-t3" } };
  "s68-t3": { input: { s: 68; t: 3 }; continueWith: { typeName: "s68-t4" } };
  "s68-t4": { input: { s: 68; t: 4 }; continueWith: { typeName: "s68-t5" } };
  "s68-t5": { input: { s: 68; t: 5 }; continueWith: { typeName: "s68-t6" } };
  "s68-t6": { input: { s: 68; t: 6 }; continueWith: { typeName: "s68-t7" } };
  "s68-t7": { input: { s: 68; t: 7 }; continueWith: { typeName: "s68-t8" } };
  "s68-t8": { input: { s: 68; t: 8 }; continueWith: { typeName: "s68-t9" } };
  "s68-t9": { input: { s: 68; t: 9 }; continueWith: { typeName: "s68-t10" } };
  "s68-t10": { input: { s: 68; t: 10 }; continueWith: { typeName: "s68-t11" } };
  "s68-t11": { input: { s: 68; t: 11 }; continueWith: { typeName: "s68-t12" } };
  "s68-t12": { input: { s: 68; t: 12 }; continueWith: { typeName: "s68-t13" } };
  "s68-t13": { input: { s: 68; t: 13 }; continueWith: { typeName: "s68-t14" } };
  "s68-t14": { input: { s: 68; t: 14 }; continueWith: { typeName: "s68-t15" } };
  "s68-t15": { input: { s: 68; t: 15 }; continueWith: { typeName: "s68-t16" } };
  "s68-t16": { input: { s: 68; t: 16 }; continueWith: { typeName: "s68-t17" } };
  "s68-t17": { input: { s: 68; t: 17 }; continueWith: { typeName: "s68-t18" } };
  "s68-t18": { input: { s: 68; t: 18 }; continueWith: { typeName: "s68-t19" } };
  "s68-t19": { input: { s: 68; t: 19 }; output: { s: 68; done: true } };
}>();

const slice69 = defineJobTypes<{
  "s69-t0": { entry: true; input: { s: 69; t: 0 }; continueWith: { typeName: "s69-t1" } };
  "s69-t1": { input: { s: 69; t: 1 }; continueWith: { typeName: "s69-t2" } };
  "s69-t2": { input: { s: 69; t: 2 }; continueWith: { typeName: "s69-t3" } };
  "s69-t3": { input: { s: 69; t: 3 }; continueWith: { typeName: "s69-t4" } };
  "s69-t4": { input: { s: 69; t: 4 }; continueWith: { typeName: "s69-t5" } };
  "s69-t5": { input: { s: 69; t: 5 }; continueWith: { typeName: "s69-t6" } };
  "s69-t6": { input: { s: 69; t: 6 }; continueWith: { typeName: "s69-t7" } };
  "s69-t7": { input: { s: 69; t: 7 }; continueWith: { typeName: "s69-t8" } };
  "s69-t8": { input: { s: 69; t: 8 }; continueWith: { typeName: "s69-t9" } };
  "s69-t9": { input: { s: 69; t: 9 }; continueWith: { typeName: "s69-t10" } };
  "s69-t10": { input: { s: 69; t: 10 }; continueWith: { typeName: "s69-t11" } };
  "s69-t11": { input: { s: 69; t: 11 }; continueWith: { typeName: "s69-t12" } };
  "s69-t12": { input: { s: 69; t: 12 }; continueWith: { typeName: "s69-t13" } };
  "s69-t13": { input: { s: 69; t: 13 }; continueWith: { typeName: "s69-t14" } };
  "s69-t14": { input: { s: 69; t: 14 }; continueWith: { typeName: "s69-t15" } };
  "s69-t15": { input: { s: 69; t: 15 }; continueWith: { typeName: "s69-t16" } };
  "s69-t16": { input: { s: 69; t: 16 }; continueWith: { typeName: "s69-t17" } };
  "s69-t17": { input: { s: 69; t: 17 }; continueWith: { typeName: "s69-t18" } };
  "s69-t18": { input: { s: 69; t: 18 }; continueWith: { typeName: "s69-t19" } };
  "s69-t19": { input: { s: 69; t: 19 }; output: { s: 69; done: true } };
}>();

const slice70 = defineJobTypes<{
  "s70-t0": { entry: true; input: { s: 70; t: 0 }; continueWith: { typeName: "s70-t1" } };
  "s70-t1": { input: { s: 70; t: 1 }; continueWith: { typeName: "s70-t2" } };
  "s70-t2": { input: { s: 70; t: 2 }; continueWith: { typeName: "s70-t3" } };
  "s70-t3": { input: { s: 70; t: 3 }; continueWith: { typeName: "s70-t4" } };
  "s70-t4": { input: { s: 70; t: 4 }; continueWith: { typeName: "s70-t5" } };
  "s70-t5": { input: { s: 70; t: 5 }; continueWith: { typeName: "s70-t6" } };
  "s70-t6": { input: { s: 70; t: 6 }; continueWith: { typeName: "s70-t7" } };
  "s70-t7": { input: { s: 70; t: 7 }; continueWith: { typeName: "s70-t8" } };
  "s70-t8": { input: { s: 70; t: 8 }; continueWith: { typeName: "s70-t9" } };
  "s70-t9": { input: { s: 70; t: 9 }; continueWith: { typeName: "s70-t10" } };
  "s70-t10": { input: { s: 70; t: 10 }; continueWith: { typeName: "s70-t11" } };
  "s70-t11": { input: { s: 70; t: 11 }; continueWith: { typeName: "s70-t12" } };
  "s70-t12": { input: { s: 70; t: 12 }; continueWith: { typeName: "s70-t13" } };
  "s70-t13": { input: { s: 70; t: 13 }; continueWith: { typeName: "s70-t14" } };
  "s70-t14": { input: { s: 70; t: 14 }; continueWith: { typeName: "s70-t15" } };
  "s70-t15": { input: { s: 70; t: 15 }; continueWith: { typeName: "s70-t16" } };
  "s70-t16": { input: { s: 70; t: 16 }; continueWith: { typeName: "s70-t17" } };
  "s70-t17": { input: { s: 70; t: 17 }; continueWith: { typeName: "s70-t18" } };
  "s70-t18": { input: { s: 70; t: 18 }; continueWith: { typeName: "s70-t19" } };
  "s70-t19": { input: { s: 70; t: 19 }; output: { s: 70; done: true } };
}>();

const slice71 = defineJobTypes<{
  "s71-t0": { entry: true; input: { s: 71; t: 0 }; continueWith: { typeName: "s71-t1" } };
  "s71-t1": { input: { s: 71; t: 1 }; continueWith: { typeName: "s71-t2" } };
  "s71-t2": { input: { s: 71; t: 2 }; continueWith: { typeName: "s71-t3" } };
  "s71-t3": { input: { s: 71; t: 3 }; continueWith: { typeName: "s71-t4" } };
  "s71-t4": { input: { s: 71; t: 4 }; continueWith: { typeName: "s71-t5" } };
  "s71-t5": { input: { s: 71; t: 5 }; continueWith: { typeName: "s71-t6" } };
  "s71-t6": { input: { s: 71; t: 6 }; continueWith: { typeName: "s71-t7" } };
  "s71-t7": { input: { s: 71; t: 7 }; continueWith: { typeName: "s71-t8" } };
  "s71-t8": { input: { s: 71; t: 8 }; continueWith: { typeName: "s71-t9" } };
  "s71-t9": { input: { s: 71; t: 9 }; continueWith: { typeName: "s71-t10" } };
  "s71-t10": { input: { s: 71; t: 10 }; continueWith: { typeName: "s71-t11" } };
  "s71-t11": { input: { s: 71; t: 11 }; continueWith: { typeName: "s71-t12" } };
  "s71-t12": { input: { s: 71; t: 12 }; continueWith: { typeName: "s71-t13" } };
  "s71-t13": { input: { s: 71; t: 13 }; continueWith: { typeName: "s71-t14" } };
  "s71-t14": { input: { s: 71; t: 14 }; continueWith: { typeName: "s71-t15" } };
  "s71-t15": { input: { s: 71; t: 15 }; continueWith: { typeName: "s71-t16" } };
  "s71-t16": { input: { s: 71; t: 16 }; continueWith: { typeName: "s71-t17" } };
  "s71-t17": { input: { s: 71; t: 17 }; continueWith: { typeName: "s71-t18" } };
  "s71-t18": { input: { s: 71; t: 18 }; continueWith: { typeName: "s71-t19" } };
  "s71-t19": { input: { s: 71; t: 19 }; output: { s: 71; done: true } };
}>();

const slice72 = defineJobTypes<{
  "s72-t0": { entry: true; input: { s: 72; t: 0 }; continueWith: { typeName: "s72-t1" } };
  "s72-t1": { input: { s: 72; t: 1 }; continueWith: { typeName: "s72-t2" } };
  "s72-t2": { input: { s: 72; t: 2 }; continueWith: { typeName: "s72-t3" } };
  "s72-t3": { input: { s: 72; t: 3 }; continueWith: { typeName: "s72-t4" } };
  "s72-t4": { input: { s: 72; t: 4 }; continueWith: { typeName: "s72-t5" } };
  "s72-t5": { input: { s: 72; t: 5 }; continueWith: { typeName: "s72-t6" } };
  "s72-t6": { input: { s: 72; t: 6 }; continueWith: { typeName: "s72-t7" } };
  "s72-t7": { input: { s: 72; t: 7 }; continueWith: { typeName: "s72-t8" } };
  "s72-t8": { input: { s: 72; t: 8 }; continueWith: { typeName: "s72-t9" } };
  "s72-t9": { input: { s: 72; t: 9 }; continueWith: { typeName: "s72-t10" } };
  "s72-t10": { input: { s: 72; t: 10 }; continueWith: { typeName: "s72-t11" } };
  "s72-t11": { input: { s: 72; t: 11 }; continueWith: { typeName: "s72-t12" } };
  "s72-t12": { input: { s: 72; t: 12 }; continueWith: { typeName: "s72-t13" } };
  "s72-t13": { input: { s: 72; t: 13 }; continueWith: { typeName: "s72-t14" } };
  "s72-t14": { input: { s: 72; t: 14 }; continueWith: { typeName: "s72-t15" } };
  "s72-t15": { input: { s: 72; t: 15 }; continueWith: { typeName: "s72-t16" } };
  "s72-t16": { input: { s: 72; t: 16 }; continueWith: { typeName: "s72-t17" } };
  "s72-t17": { input: { s: 72; t: 17 }; continueWith: { typeName: "s72-t18" } };
  "s72-t18": { input: { s: 72; t: 18 }; continueWith: { typeName: "s72-t19" } };
  "s72-t19": { input: { s: 72; t: 19 }; output: { s: 72; done: true } };
}>();

const slice73 = defineJobTypes<{
  "s73-t0": { entry: true; input: { s: 73; t: 0 }; continueWith: { typeName: "s73-t1" } };
  "s73-t1": { input: { s: 73; t: 1 }; continueWith: { typeName: "s73-t2" } };
  "s73-t2": { input: { s: 73; t: 2 }; continueWith: { typeName: "s73-t3" } };
  "s73-t3": { input: { s: 73; t: 3 }; continueWith: { typeName: "s73-t4" } };
  "s73-t4": { input: { s: 73; t: 4 }; continueWith: { typeName: "s73-t5" } };
  "s73-t5": { input: { s: 73; t: 5 }; continueWith: { typeName: "s73-t6" } };
  "s73-t6": { input: { s: 73; t: 6 }; continueWith: { typeName: "s73-t7" } };
  "s73-t7": { input: { s: 73; t: 7 }; continueWith: { typeName: "s73-t8" } };
  "s73-t8": { input: { s: 73; t: 8 }; continueWith: { typeName: "s73-t9" } };
  "s73-t9": { input: { s: 73; t: 9 }; continueWith: { typeName: "s73-t10" } };
  "s73-t10": { input: { s: 73; t: 10 }; continueWith: { typeName: "s73-t11" } };
  "s73-t11": { input: { s: 73; t: 11 }; continueWith: { typeName: "s73-t12" } };
  "s73-t12": { input: { s: 73; t: 12 }; continueWith: { typeName: "s73-t13" } };
  "s73-t13": { input: { s: 73; t: 13 }; continueWith: { typeName: "s73-t14" } };
  "s73-t14": { input: { s: 73; t: 14 }; continueWith: { typeName: "s73-t15" } };
  "s73-t15": { input: { s: 73; t: 15 }; continueWith: { typeName: "s73-t16" } };
  "s73-t16": { input: { s: 73; t: 16 }; continueWith: { typeName: "s73-t17" } };
  "s73-t17": { input: { s: 73; t: 17 }; continueWith: { typeName: "s73-t18" } };
  "s73-t18": { input: { s: 73; t: 18 }; continueWith: { typeName: "s73-t19" } };
  "s73-t19": { input: { s: 73; t: 19 }; output: { s: 73; done: true } };
}>();

const slice74 = defineJobTypes<{
  "s74-t0": { entry: true; input: { s: 74; t: 0 }; continueWith: { typeName: "s74-t1" } };
  "s74-t1": { input: { s: 74; t: 1 }; continueWith: { typeName: "s74-t2" } };
  "s74-t2": { input: { s: 74; t: 2 }; continueWith: { typeName: "s74-t3" } };
  "s74-t3": { input: { s: 74; t: 3 }; continueWith: { typeName: "s74-t4" } };
  "s74-t4": { input: { s: 74; t: 4 }; continueWith: { typeName: "s74-t5" } };
  "s74-t5": { input: { s: 74; t: 5 }; continueWith: { typeName: "s74-t6" } };
  "s74-t6": { input: { s: 74; t: 6 }; continueWith: { typeName: "s74-t7" } };
  "s74-t7": { input: { s: 74; t: 7 }; continueWith: { typeName: "s74-t8" } };
  "s74-t8": { input: { s: 74; t: 8 }; continueWith: { typeName: "s74-t9" } };
  "s74-t9": { input: { s: 74; t: 9 }; continueWith: { typeName: "s74-t10" } };
  "s74-t10": { input: { s: 74; t: 10 }; continueWith: { typeName: "s74-t11" } };
  "s74-t11": { input: { s: 74; t: 11 }; continueWith: { typeName: "s74-t12" } };
  "s74-t12": { input: { s: 74; t: 12 }; continueWith: { typeName: "s74-t13" } };
  "s74-t13": { input: { s: 74; t: 13 }; continueWith: { typeName: "s74-t14" } };
  "s74-t14": { input: { s: 74; t: 14 }; continueWith: { typeName: "s74-t15" } };
  "s74-t15": { input: { s: 74; t: 15 }; continueWith: { typeName: "s74-t16" } };
  "s74-t16": { input: { s: 74; t: 16 }; continueWith: { typeName: "s74-t17" } };
  "s74-t17": { input: { s: 74; t: 17 }; continueWith: { typeName: "s74-t18" } };
  "s74-t18": { input: { s: 74; t: 18 }; continueWith: { typeName: "s74-t19" } };
  "s74-t19": { input: { s: 74; t: 19 }; output: { s: 74; done: true } };
}>();

const slice75 = defineJobTypes<{
  "s75-t0": { entry: true; input: { s: 75; t: 0 }; continueWith: { typeName: "s75-t1" } };
  "s75-t1": { input: { s: 75; t: 1 }; continueWith: { typeName: "s75-t2" } };
  "s75-t2": { input: { s: 75; t: 2 }; continueWith: { typeName: "s75-t3" } };
  "s75-t3": { input: { s: 75; t: 3 }; continueWith: { typeName: "s75-t4" } };
  "s75-t4": { input: { s: 75; t: 4 }; continueWith: { typeName: "s75-t5" } };
  "s75-t5": { input: { s: 75; t: 5 }; continueWith: { typeName: "s75-t6" } };
  "s75-t6": { input: { s: 75; t: 6 }; continueWith: { typeName: "s75-t7" } };
  "s75-t7": { input: { s: 75; t: 7 }; continueWith: { typeName: "s75-t8" } };
  "s75-t8": { input: { s: 75; t: 8 }; continueWith: { typeName: "s75-t9" } };
  "s75-t9": { input: { s: 75; t: 9 }; continueWith: { typeName: "s75-t10" } };
  "s75-t10": { input: { s: 75; t: 10 }; continueWith: { typeName: "s75-t11" } };
  "s75-t11": { input: { s: 75; t: 11 }; continueWith: { typeName: "s75-t12" } };
  "s75-t12": { input: { s: 75; t: 12 }; continueWith: { typeName: "s75-t13" } };
  "s75-t13": { input: { s: 75; t: 13 }; continueWith: { typeName: "s75-t14" } };
  "s75-t14": { input: { s: 75; t: 14 }; continueWith: { typeName: "s75-t15" } };
  "s75-t15": { input: { s: 75; t: 15 }; continueWith: { typeName: "s75-t16" } };
  "s75-t16": { input: { s: 75; t: 16 }; continueWith: { typeName: "s75-t17" } };
  "s75-t17": { input: { s: 75; t: 17 }; continueWith: { typeName: "s75-t18" } };
  "s75-t18": { input: { s: 75; t: 18 }; continueWith: { typeName: "s75-t19" } };
  "s75-t19": { input: { s: 75; t: 19 }; output: { s: 75; done: true } };
}>();

const slice76 = defineJobTypes<{
  "s76-t0": { entry: true; input: { s: 76; t: 0 }; continueWith: { typeName: "s76-t1" } };
  "s76-t1": { input: { s: 76; t: 1 }; continueWith: { typeName: "s76-t2" } };
  "s76-t2": { input: { s: 76; t: 2 }; continueWith: { typeName: "s76-t3" } };
  "s76-t3": { input: { s: 76; t: 3 }; continueWith: { typeName: "s76-t4" } };
  "s76-t4": { input: { s: 76; t: 4 }; continueWith: { typeName: "s76-t5" } };
  "s76-t5": { input: { s: 76; t: 5 }; continueWith: { typeName: "s76-t6" } };
  "s76-t6": { input: { s: 76; t: 6 }; continueWith: { typeName: "s76-t7" } };
  "s76-t7": { input: { s: 76; t: 7 }; continueWith: { typeName: "s76-t8" } };
  "s76-t8": { input: { s: 76; t: 8 }; continueWith: { typeName: "s76-t9" } };
  "s76-t9": { input: { s: 76; t: 9 }; continueWith: { typeName: "s76-t10" } };
  "s76-t10": { input: { s: 76; t: 10 }; continueWith: { typeName: "s76-t11" } };
  "s76-t11": { input: { s: 76; t: 11 }; continueWith: { typeName: "s76-t12" } };
  "s76-t12": { input: { s: 76; t: 12 }; continueWith: { typeName: "s76-t13" } };
  "s76-t13": { input: { s: 76; t: 13 }; continueWith: { typeName: "s76-t14" } };
  "s76-t14": { input: { s: 76; t: 14 }; continueWith: { typeName: "s76-t15" } };
  "s76-t15": { input: { s: 76; t: 15 }; continueWith: { typeName: "s76-t16" } };
  "s76-t16": { input: { s: 76; t: 16 }; continueWith: { typeName: "s76-t17" } };
  "s76-t17": { input: { s: 76; t: 17 }; continueWith: { typeName: "s76-t18" } };
  "s76-t18": { input: { s: 76; t: 18 }; continueWith: { typeName: "s76-t19" } };
  "s76-t19": { input: { s: 76; t: 19 }; output: { s: 76; done: true } };
}>();

const slice77 = defineJobTypes<{
  "s77-t0": { entry: true; input: { s: 77; t: 0 }; continueWith: { typeName: "s77-t1" } };
  "s77-t1": { input: { s: 77; t: 1 }; continueWith: { typeName: "s77-t2" } };
  "s77-t2": { input: { s: 77; t: 2 }; continueWith: { typeName: "s77-t3" } };
  "s77-t3": { input: { s: 77; t: 3 }; continueWith: { typeName: "s77-t4" } };
  "s77-t4": { input: { s: 77; t: 4 }; continueWith: { typeName: "s77-t5" } };
  "s77-t5": { input: { s: 77; t: 5 }; continueWith: { typeName: "s77-t6" } };
  "s77-t6": { input: { s: 77; t: 6 }; continueWith: { typeName: "s77-t7" } };
  "s77-t7": { input: { s: 77; t: 7 }; continueWith: { typeName: "s77-t8" } };
  "s77-t8": { input: { s: 77; t: 8 }; continueWith: { typeName: "s77-t9" } };
  "s77-t9": { input: { s: 77; t: 9 }; continueWith: { typeName: "s77-t10" } };
  "s77-t10": { input: { s: 77; t: 10 }; continueWith: { typeName: "s77-t11" } };
  "s77-t11": { input: { s: 77; t: 11 }; continueWith: { typeName: "s77-t12" } };
  "s77-t12": { input: { s: 77; t: 12 }; continueWith: { typeName: "s77-t13" } };
  "s77-t13": { input: { s: 77; t: 13 }; continueWith: { typeName: "s77-t14" } };
  "s77-t14": { input: { s: 77; t: 14 }; continueWith: { typeName: "s77-t15" } };
  "s77-t15": { input: { s: 77; t: 15 }; continueWith: { typeName: "s77-t16" } };
  "s77-t16": { input: { s: 77; t: 16 }; continueWith: { typeName: "s77-t17" } };
  "s77-t17": { input: { s: 77; t: 17 }; continueWith: { typeName: "s77-t18" } };
  "s77-t18": { input: { s: 77; t: 18 }; continueWith: { typeName: "s77-t19" } };
  "s77-t19": { input: { s: 77; t: 19 }; output: { s: 77; done: true } };
}>();

const slice78 = defineJobTypes<{
  "s78-t0": { entry: true; input: { s: 78; t: 0 }; continueWith: { typeName: "s78-t1" } };
  "s78-t1": { input: { s: 78; t: 1 }; continueWith: { typeName: "s78-t2" } };
  "s78-t2": { input: { s: 78; t: 2 }; continueWith: { typeName: "s78-t3" } };
  "s78-t3": { input: { s: 78; t: 3 }; continueWith: { typeName: "s78-t4" } };
  "s78-t4": { input: { s: 78; t: 4 }; continueWith: { typeName: "s78-t5" } };
  "s78-t5": { input: { s: 78; t: 5 }; continueWith: { typeName: "s78-t6" } };
  "s78-t6": { input: { s: 78; t: 6 }; continueWith: { typeName: "s78-t7" } };
  "s78-t7": { input: { s: 78; t: 7 }; continueWith: { typeName: "s78-t8" } };
  "s78-t8": { input: { s: 78; t: 8 }; continueWith: { typeName: "s78-t9" } };
  "s78-t9": { input: { s: 78; t: 9 }; continueWith: { typeName: "s78-t10" } };
  "s78-t10": { input: { s: 78; t: 10 }; continueWith: { typeName: "s78-t11" } };
  "s78-t11": { input: { s: 78; t: 11 }; continueWith: { typeName: "s78-t12" } };
  "s78-t12": { input: { s: 78; t: 12 }; continueWith: { typeName: "s78-t13" } };
  "s78-t13": { input: { s: 78; t: 13 }; continueWith: { typeName: "s78-t14" } };
  "s78-t14": { input: { s: 78; t: 14 }; continueWith: { typeName: "s78-t15" } };
  "s78-t15": { input: { s: 78; t: 15 }; continueWith: { typeName: "s78-t16" } };
  "s78-t16": { input: { s: 78; t: 16 }; continueWith: { typeName: "s78-t17" } };
  "s78-t17": { input: { s: 78; t: 17 }; continueWith: { typeName: "s78-t18" } };
  "s78-t18": { input: { s: 78; t: 18 }; continueWith: { typeName: "s78-t19" } };
  "s78-t19": { input: { s: 78; t: 19 }; output: { s: 78; done: true } };
}>();

const slice79 = defineJobTypes<{
  "s79-t0": { entry: true; input: { s: 79; t: 0 }; continueWith: { typeName: "s79-t1" } };
  "s79-t1": { input: { s: 79; t: 1 }; continueWith: { typeName: "s79-t2" } };
  "s79-t2": { input: { s: 79; t: 2 }; continueWith: { typeName: "s79-t3" } };
  "s79-t3": { input: { s: 79; t: 3 }; continueWith: { typeName: "s79-t4" } };
  "s79-t4": { input: { s: 79; t: 4 }; continueWith: { typeName: "s79-t5" } };
  "s79-t5": { input: { s: 79; t: 5 }; continueWith: { typeName: "s79-t6" } };
  "s79-t6": { input: { s: 79; t: 6 }; continueWith: { typeName: "s79-t7" } };
  "s79-t7": { input: { s: 79; t: 7 }; continueWith: { typeName: "s79-t8" } };
  "s79-t8": { input: { s: 79; t: 8 }; continueWith: { typeName: "s79-t9" } };
  "s79-t9": { input: { s: 79; t: 9 }; continueWith: { typeName: "s79-t10" } };
  "s79-t10": { input: { s: 79; t: 10 }; continueWith: { typeName: "s79-t11" } };
  "s79-t11": { input: { s: 79; t: 11 }; continueWith: { typeName: "s79-t12" } };
  "s79-t12": { input: { s: 79; t: 12 }; continueWith: { typeName: "s79-t13" } };
  "s79-t13": { input: { s: 79; t: 13 }; continueWith: { typeName: "s79-t14" } };
  "s79-t14": { input: { s: 79; t: 14 }; continueWith: { typeName: "s79-t15" } };
  "s79-t15": { input: { s: 79; t: 15 }; continueWith: { typeName: "s79-t16" } };
  "s79-t16": { input: { s: 79; t: 16 }; continueWith: { typeName: "s79-t17" } };
  "s79-t17": { input: { s: 79; t: 17 }; continueWith: { typeName: "s79-t18" } };
  "s79-t18": { input: { s: 79; t: 18 }; continueWith: { typeName: "s79-t19" } };
  "s79-t19": { input: { s: 79; t: 19 }; output: { s: 79; done: true } };
}>();

const slice80 = defineJobTypes<{
  "s80-t0": { entry: true; input: { s: 80; t: 0 }; continueWith: { typeName: "s80-t1" } };
  "s80-t1": { input: { s: 80; t: 1 }; continueWith: { typeName: "s80-t2" } };
  "s80-t2": { input: { s: 80; t: 2 }; continueWith: { typeName: "s80-t3" } };
  "s80-t3": { input: { s: 80; t: 3 }; continueWith: { typeName: "s80-t4" } };
  "s80-t4": { input: { s: 80; t: 4 }; continueWith: { typeName: "s80-t5" } };
  "s80-t5": { input: { s: 80; t: 5 }; continueWith: { typeName: "s80-t6" } };
  "s80-t6": { input: { s: 80; t: 6 }; continueWith: { typeName: "s80-t7" } };
  "s80-t7": { input: { s: 80; t: 7 }; continueWith: { typeName: "s80-t8" } };
  "s80-t8": { input: { s: 80; t: 8 }; continueWith: { typeName: "s80-t9" } };
  "s80-t9": { input: { s: 80; t: 9 }; continueWith: { typeName: "s80-t10" } };
  "s80-t10": { input: { s: 80; t: 10 }; continueWith: { typeName: "s80-t11" } };
  "s80-t11": { input: { s: 80; t: 11 }; continueWith: { typeName: "s80-t12" } };
  "s80-t12": { input: { s: 80; t: 12 }; continueWith: { typeName: "s80-t13" } };
  "s80-t13": { input: { s: 80; t: 13 }; continueWith: { typeName: "s80-t14" } };
  "s80-t14": { input: { s: 80; t: 14 }; continueWith: { typeName: "s80-t15" } };
  "s80-t15": { input: { s: 80; t: 15 }; continueWith: { typeName: "s80-t16" } };
  "s80-t16": { input: { s: 80; t: 16 }; continueWith: { typeName: "s80-t17" } };
  "s80-t17": { input: { s: 80; t: 17 }; continueWith: { typeName: "s80-t18" } };
  "s80-t18": { input: { s: 80; t: 18 }; continueWith: { typeName: "s80-t19" } };
  "s80-t19": { input: { s: 80; t: 19 }; output: { s: 80; done: true } };
}>();

const slice81 = defineJobTypes<{
  "s81-t0": { entry: true; input: { s: 81; t: 0 }; continueWith: { typeName: "s81-t1" } };
  "s81-t1": { input: { s: 81; t: 1 }; continueWith: { typeName: "s81-t2" } };
  "s81-t2": { input: { s: 81; t: 2 }; continueWith: { typeName: "s81-t3" } };
  "s81-t3": { input: { s: 81; t: 3 }; continueWith: { typeName: "s81-t4" } };
  "s81-t4": { input: { s: 81; t: 4 }; continueWith: { typeName: "s81-t5" } };
  "s81-t5": { input: { s: 81; t: 5 }; continueWith: { typeName: "s81-t6" } };
  "s81-t6": { input: { s: 81; t: 6 }; continueWith: { typeName: "s81-t7" } };
  "s81-t7": { input: { s: 81; t: 7 }; continueWith: { typeName: "s81-t8" } };
  "s81-t8": { input: { s: 81; t: 8 }; continueWith: { typeName: "s81-t9" } };
  "s81-t9": { input: { s: 81; t: 9 }; continueWith: { typeName: "s81-t10" } };
  "s81-t10": { input: { s: 81; t: 10 }; continueWith: { typeName: "s81-t11" } };
  "s81-t11": { input: { s: 81; t: 11 }; continueWith: { typeName: "s81-t12" } };
  "s81-t12": { input: { s: 81; t: 12 }; continueWith: { typeName: "s81-t13" } };
  "s81-t13": { input: { s: 81; t: 13 }; continueWith: { typeName: "s81-t14" } };
  "s81-t14": { input: { s: 81; t: 14 }; continueWith: { typeName: "s81-t15" } };
  "s81-t15": { input: { s: 81; t: 15 }; continueWith: { typeName: "s81-t16" } };
  "s81-t16": { input: { s: 81; t: 16 }; continueWith: { typeName: "s81-t17" } };
  "s81-t17": { input: { s: 81; t: 17 }; continueWith: { typeName: "s81-t18" } };
  "s81-t18": { input: { s: 81; t: 18 }; continueWith: { typeName: "s81-t19" } };
  "s81-t19": { input: { s: 81; t: 19 }; output: { s: 81; done: true } };
}>();

const slice82 = defineJobTypes<{
  "s82-t0": { entry: true; input: { s: 82; t: 0 }; continueWith: { typeName: "s82-t1" } };
  "s82-t1": { input: { s: 82; t: 1 }; continueWith: { typeName: "s82-t2" } };
  "s82-t2": { input: { s: 82; t: 2 }; continueWith: { typeName: "s82-t3" } };
  "s82-t3": { input: { s: 82; t: 3 }; continueWith: { typeName: "s82-t4" } };
  "s82-t4": { input: { s: 82; t: 4 }; continueWith: { typeName: "s82-t5" } };
  "s82-t5": { input: { s: 82; t: 5 }; continueWith: { typeName: "s82-t6" } };
  "s82-t6": { input: { s: 82; t: 6 }; continueWith: { typeName: "s82-t7" } };
  "s82-t7": { input: { s: 82; t: 7 }; continueWith: { typeName: "s82-t8" } };
  "s82-t8": { input: { s: 82; t: 8 }; continueWith: { typeName: "s82-t9" } };
  "s82-t9": { input: { s: 82; t: 9 }; continueWith: { typeName: "s82-t10" } };
  "s82-t10": { input: { s: 82; t: 10 }; continueWith: { typeName: "s82-t11" } };
  "s82-t11": { input: { s: 82; t: 11 }; continueWith: { typeName: "s82-t12" } };
  "s82-t12": { input: { s: 82; t: 12 }; continueWith: { typeName: "s82-t13" } };
  "s82-t13": { input: { s: 82; t: 13 }; continueWith: { typeName: "s82-t14" } };
  "s82-t14": { input: { s: 82; t: 14 }; continueWith: { typeName: "s82-t15" } };
  "s82-t15": { input: { s: 82; t: 15 }; continueWith: { typeName: "s82-t16" } };
  "s82-t16": { input: { s: 82; t: 16 }; continueWith: { typeName: "s82-t17" } };
  "s82-t17": { input: { s: 82; t: 17 }; continueWith: { typeName: "s82-t18" } };
  "s82-t18": { input: { s: 82; t: 18 }; continueWith: { typeName: "s82-t19" } };
  "s82-t19": { input: { s: 82; t: 19 }; output: { s: 82; done: true } };
}>();

const slice83 = defineJobTypes<{
  "s83-t0": { entry: true; input: { s: 83; t: 0 }; continueWith: { typeName: "s83-t1" } };
  "s83-t1": { input: { s: 83; t: 1 }; continueWith: { typeName: "s83-t2" } };
  "s83-t2": { input: { s: 83; t: 2 }; continueWith: { typeName: "s83-t3" } };
  "s83-t3": { input: { s: 83; t: 3 }; continueWith: { typeName: "s83-t4" } };
  "s83-t4": { input: { s: 83; t: 4 }; continueWith: { typeName: "s83-t5" } };
  "s83-t5": { input: { s: 83; t: 5 }; continueWith: { typeName: "s83-t6" } };
  "s83-t6": { input: { s: 83; t: 6 }; continueWith: { typeName: "s83-t7" } };
  "s83-t7": { input: { s: 83; t: 7 }; continueWith: { typeName: "s83-t8" } };
  "s83-t8": { input: { s: 83; t: 8 }; continueWith: { typeName: "s83-t9" } };
  "s83-t9": { input: { s: 83; t: 9 }; continueWith: { typeName: "s83-t10" } };
  "s83-t10": { input: { s: 83; t: 10 }; continueWith: { typeName: "s83-t11" } };
  "s83-t11": { input: { s: 83; t: 11 }; continueWith: { typeName: "s83-t12" } };
  "s83-t12": { input: { s: 83; t: 12 }; continueWith: { typeName: "s83-t13" } };
  "s83-t13": { input: { s: 83; t: 13 }; continueWith: { typeName: "s83-t14" } };
  "s83-t14": { input: { s: 83; t: 14 }; continueWith: { typeName: "s83-t15" } };
  "s83-t15": { input: { s: 83; t: 15 }; continueWith: { typeName: "s83-t16" } };
  "s83-t16": { input: { s: 83; t: 16 }; continueWith: { typeName: "s83-t17" } };
  "s83-t17": { input: { s: 83; t: 17 }; continueWith: { typeName: "s83-t18" } };
  "s83-t18": { input: { s: 83; t: 18 }; continueWith: { typeName: "s83-t19" } };
  "s83-t19": { input: { s: 83; t: 19 }; output: { s: 83; done: true } };
}>();

const slice84 = defineJobTypes<{
  "s84-t0": { entry: true; input: { s: 84; t: 0 }; continueWith: { typeName: "s84-t1" } };
  "s84-t1": { input: { s: 84; t: 1 }; continueWith: { typeName: "s84-t2" } };
  "s84-t2": { input: { s: 84; t: 2 }; continueWith: { typeName: "s84-t3" } };
  "s84-t3": { input: { s: 84; t: 3 }; continueWith: { typeName: "s84-t4" } };
  "s84-t4": { input: { s: 84; t: 4 }; continueWith: { typeName: "s84-t5" } };
  "s84-t5": { input: { s: 84; t: 5 }; continueWith: { typeName: "s84-t6" } };
  "s84-t6": { input: { s: 84; t: 6 }; continueWith: { typeName: "s84-t7" } };
  "s84-t7": { input: { s: 84; t: 7 }; continueWith: { typeName: "s84-t8" } };
  "s84-t8": { input: { s: 84; t: 8 }; continueWith: { typeName: "s84-t9" } };
  "s84-t9": { input: { s: 84; t: 9 }; continueWith: { typeName: "s84-t10" } };
  "s84-t10": { input: { s: 84; t: 10 }; continueWith: { typeName: "s84-t11" } };
  "s84-t11": { input: { s: 84; t: 11 }; continueWith: { typeName: "s84-t12" } };
  "s84-t12": { input: { s: 84; t: 12 }; continueWith: { typeName: "s84-t13" } };
  "s84-t13": { input: { s: 84; t: 13 }; continueWith: { typeName: "s84-t14" } };
  "s84-t14": { input: { s: 84; t: 14 }; continueWith: { typeName: "s84-t15" } };
  "s84-t15": { input: { s: 84; t: 15 }; continueWith: { typeName: "s84-t16" } };
  "s84-t16": { input: { s: 84; t: 16 }; continueWith: { typeName: "s84-t17" } };
  "s84-t17": { input: { s: 84; t: 17 }; continueWith: { typeName: "s84-t18" } };
  "s84-t18": { input: { s: 84; t: 18 }; continueWith: { typeName: "s84-t19" } };
  "s84-t19": { input: { s: 84; t: 19 }; output: { s: 84; done: true } };
}>();

const slice85 = defineJobTypes<{
  "s85-t0": { entry: true; input: { s: 85; t: 0 }; continueWith: { typeName: "s85-t1" } };
  "s85-t1": { input: { s: 85; t: 1 }; continueWith: { typeName: "s85-t2" } };
  "s85-t2": { input: { s: 85; t: 2 }; continueWith: { typeName: "s85-t3" } };
  "s85-t3": { input: { s: 85; t: 3 }; continueWith: { typeName: "s85-t4" } };
  "s85-t4": { input: { s: 85; t: 4 }; continueWith: { typeName: "s85-t5" } };
  "s85-t5": { input: { s: 85; t: 5 }; continueWith: { typeName: "s85-t6" } };
  "s85-t6": { input: { s: 85; t: 6 }; continueWith: { typeName: "s85-t7" } };
  "s85-t7": { input: { s: 85; t: 7 }; continueWith: { typeName: "s85-t8" } };
  "s85-t8": { input: { s: 85; t: 8 }; continueWith: { typeName: "s85-t9" } };
  "s85-t9": { input: { s: 85; t: 9 }; continueWith: { typeName: "s85-t10" } };
  "s85-t10": { input: { s: 85; t: 10 }; continueWith: { typeName: "s85-t11" } };
  "s85-t11": { input: { s: 85; t: 11 }; continueWith: { typeName: "s85-t12" } };
  "s85-t12": { input: { s: 85; t: 12 }; continueWith: { typeName: "s85-t13" } };
  "s85-t13": { input: { s: 85; t: 13 }; continueWith: { typeName: "s85-t14" } };
  "s85-t14": { input: { s: 85; t: 14 }; continueWith: { typeName: "s85-t15" } };
  "s85-t15": { input: { s: 85; t: 15 }; continueWith: { typeName: "s85-t16" } };
  "s85-t16": { input: { s: 85; t: 16 }; continueWith: { typeName: "s85-t17" } };
  "s85-t17": { input: { s: 85; t: 17 }; continueWith: { typeName: "s85-t18" } };
  "s85-t18": { input: { s: 85; t: 18 }; continueWith: { typeName: "s85-t19" } };
  "s85-t19": { input: { s: 85; t: 19 }; output: { s: 85; done: true } };
}>();

const slice86 = defineJobTypes<{
  "s86-t0": { entry: true; input: { s: 86; t: 0 }; continueWith: { typeName: "s86-t1" } };
  "s86-t1": { input: { s: 86; t: 1 }; continueWith: { typeName: "s86-t2" } };
  "s86-t2": { input: { s: 86; t: 2 }; continueWith: { typeName: "s86-t3" } };
  "s86-t3": { input: { s: 86; t: 3 }; continueWith: { typeName: "s86-t4" } };
  "s86-t4": { input: { s: 86; t: 4 }; continueWith: { typeName: "s86-t5" } };
  "s86-t5": { input: { s: 86; t: 5 }; continueWith: { typeName: "s86-t6" } };
  "s86-t6": { input: { s: 86; t: 6 }; continueWith: { typeName: "s86-t7" } };
  "s86-t7": { input: { s: 86; t: 7 }; continueWith: { typeName: "s86-t8" } };
  "s86-t8": { input: { s: 86; t: 8 }; continueWith: { typeName: "s86-t9" } };
  "s86-t9": { input: { s: 86; t: 9 }; continueWith: { typeName: "s86-t10" } };
  "s86-t10": { input: { s: 86; t: 10 }; continueWith: { typeName: "s86-t11" } };
  "s86-t11": { input: { s: 86; t: 11 }; continueWith: { typeName: "s86-t12" } };
  "s86-t12": { input: { s: 86; t: 12 }; continueWith: { typeName: "s86-t13" } };
  "s86-t13": { input: { s: 86; t: 13 }; continueWith: { typeName: "s86-t14" } };
  "s86-t14": { input: { s: 86; t: 14 }; continueWith: { typeName: "s86-t15" } };
  "s86-t15": { input: { s: 86; t: 15 }; continueWith: { typeName: "s86-t16" } };
  "s86-t16": { input: { s: 86; t: 16 }; continueWith: { typeName: "s86-t17" } };
  "s86-t17": { input: { s: 86; t: 17 }; continueWith: { typeName: "s86-t18" } };
  "s86-t18": { input: { s: 86; t: 18 }; continueWith: { typeName: "s86-t19" } };
  "s86-t19": { input: { s: 86; t: 19 }; output: { s: 86; done: true } };
}>();

const slice87 = defineJobTypes<{
  "s87-t0": { entry: true; input: { s: 87; t: 0 }; continueWith: { typeName: "s87-t1" } };
  "s87-t1": { input: { s: 87; t: 1 }; continueWith: { typeName: "s87-t2" } };
  "s87-t2": { input: { s: 87; t: 2 }; continueWith: { typeName: "s87-t3" } };
  "s87-t3": { input: { s: 87; t: 3 }; continueWith: { typeName: "s87-t4" } };
  "s87-t4": { input: { s: 87; t: 4 }; continueWith: { typeName: "s87-t5" } };
  "s87-t5": { input: { s: 87; t: 5 }; continueWith: { typeName: "s87-t6" } };
  "s87-t6": { input: { s: 87; t: 6 }; continueWith: { typeName: "s87-t7" } };
  "s87-t7": { input: { s: 87; t: 7 }; continueWith: { typeName: "s87-t8" } };
  "s87-t8": { input: { s: 87; t: 8 }; continueWith: { typeName: "s87-t9" } };
  "s87-t9": { input: { s: 87; t: 9 }; continueWith: { typeName: "s87-t10" } };
  "s87-t10": { input: { s: 87; t: 10 }; continueWith: { typeName: "s87-t11" } };
  "s87-t11": { input: { s: 87; t: 11 }; continueWith: { typeName: "s87-t12" } };
  "s87-t12": { input: { s: 87; t: 12 }; continueWith: { typeName: "s87-t13" } };
  "s87-t13": { input: { s: 87; t: 13 }; continueWith: { typeName: "s87-t14" } };
  "s87-t14": { input: { s: 87; t: 14 }; continueWith: { typeName: "s87-t15" } };
  "s87-t15": { input: { s: 87; t: 15 }; continueWith: { typeName: "s87-t16" } };
  "s87-t16": { input: { s: 87; t: 16 }; continueWith: { typeName: "s87-t17" } };
  "s87-t17": { input: { s: 87; t: 17 }; continueWith: { typeName: "s87-t18" } };
  "s87-t18": { input: { s: 87; t: 18 }; continueWith: { typeName: "s87-t19" } };
  "s87-t19": { input: { s: 87; t: 19 }; output: { s: 87; done: true } };
}>();

const slice88 = defineJobTypes<{
  "s88-t0": { entry: true; input: { s: 88; t: 0 }; continueWith: { typeName: "s88-t1" } };
  "s88-t1": { input: { s: 88; t: 1 }; continueWith: { typeName: "s88-t2" } };
  "s88-t2": { input: { s: 88; t: 2 }; continueWith: { typeName: "s88-t3" } };
  "s88-t3": { input: { s: 88; t: 3 }; continueWith: { typeName: "s88-t4" } };
  "s88-t4": { input: { s: 88; t: 4 }; continueWith: { typeName: "s88-t5" } };
  "s88-t5": { input: { s: 88; t: 5 }; continueWith: { typeName: "s88-t6" } };
  "s88-t6": { input: { s: 88; t: 6 }; continueWith: { typeName: "s88-t7" } };
  "s88-t7": { input: { s: 88; t: 7 }; continueWith: { typeName: "s88-t8" } };
  "s88-t8": { input: { s: 88; t: 8 }; continueWith: { typeName: "s88-t9" } };
  "s88-t9": { input: { s: 88; t: 9 }; continueWith: { typeName: "s88-t10" } };
  "s88-t10": { input: { s: 88; t: 10 }; continueWith: { typeName: "s88-t11" } };
  "s88-t11": { input: { s: 88; t: 11 }; continueWith: { typeName: "s88-t12" } };
  "s88-t12": { input: { s: 88; t: 12 }; continueWith: { typeName: "s88-t13" } };
  "s88-t13": { input: { s: 88; t: 13 }; continueWith: { typeName: "s88-t14" } };
  "s88-t14": { input: { s: 88; t: 14 }; continueWith: { typeName: "s88-t15" } };
  "s88-t15": { input: { s: 88; t: 15 }; continueWith: { typeName: "s88-t16" } };
  "s88-t16": { input: { s: 88; t: 16 }; continueWith: { typeName: "s88-t17" } };
  "s88-t17": { input: { s: 88; t: 17 }; continueWith: { typeName: "s88-t18" } };
  "s88-t18": { input: { s: 88; t: 18 }; continueWith: { typeName: "s88-t19" } };
  "s88-t19": { input: { s: 88; t: 19 }; output: { s: 88; done: true } };
}>();

const slice89 = defineJobTypes<{
  "s89-t0": { entry: true; input: { s: 89; t: 0 }; continueWith: { typeName: "s89-t1" } };
  "s89-t1": { input: { s: 89; t: 1 }; continueWith: { typeName: "s89-t2" } };
  "s89-t2": { input: { s: 89; t: 2 }; continueWith: { typeName: "s89-t3" } };
  "s89-t3": { input: { s: 89; t: 3 }; continueWith: { typeName: "s89-t4" } };
  "s89-t4": { input: { s: 89; t: 4 }; continueWith: { typeName: "s89-t5" } };
  "s89-t5": { input: { s: 89; t: 5 }; continueWith: { typeName: "s89-t6" } };
  "s89-t6": { input: { s: 89; t: 6 }; continueWith: { typeName: "s89-t7" } };
  "s89-t7": { input: { s: 89; t: 7 }; continueWith: { typeName: "s89-t8" } };
  "s89-t8": { input: { s: 89; t: 8 }; continueWith: { typeName: "s89-t9" } };
  "s89-t9": { input: { s: 89; t: 9 }; continueWith: { typeName: "s89-t10" } };
  "s89-t10": { input: { s: 89; t: 10 }; continueWith: { typeName: "s89-t11" } };
  "s89-t11": { input: { s: 89; t: 11 }; continueWith: { typeName: "s89-t12" } };
  "s89-t12": { input: { s: 89; t: 12 }; continueWith: { typeName: "s89-t13" } };
  "s89-t13": { input: { s: 89; t: 13 }; continueWith: { typeName: "s89-t14" } };
  "s89-t14": { input: { s: 89; t: 14 }; continueWith: { typeName: "s89-t15" } };
  "s89-t15": { input: { s: 89; t: 15 }; continueWith: { typeName: "s89-t16" } };
  "s89-t16": { input: { s: 89; t: 16 }; continueWith: { typeName: "s89-t17" } };
  "s89-t17": { input: { s: 89; t: 17 }; continueWith: { typeName: "s89-t18" } };
  "s89-t18": { input: { s: 89; t: 18 }; continueWith: { typeName: "s89-t19" } };
  "s89-t19": { input: { s: 89; t: 19 }; output: { s: 89; done: true } };
}>();

const slice90 = defineJobTypes<{
  "s90-t0": { entry: true; input: { s: 90; t: 0 }; continueWith: { typeName: "s90-t1" } };
  "s90-t1": { input: { s: 90; t: 1 }; continueWith: { typeName: "s90-t2" } };
  "s90-t2": { input: { s: 90; t: 2 }; continueWith: { typeName: "s90-t3" } };
  "s90-t3": { input: { s: 90; t: 3 }; continueWith: { typeName: "s90-t4" } };
  "s90-t4": { input: { s: 90; t: 4 }; continueWith: { typeName: "s90-t5" } };
  "s90-t5": { input: { s: 90; t: 5 }; continueWith: { typeName: "s90-t6" } };
  "s90-t6": { input: { s: 90; t: 6 }; continueWith: { typeName: "s90-t7" } };
  "s90-t7": { input: { s: 90; t: 7 }; continueWith: { typeName: "s90-t8" } };
  "s90-t8": { input: { s: 90; t: 8 }; continueWith: { typeName: "s90-t9" } };
  "s90-t9": { input: { s: 90; t: 9 }; continueWith: { typeName: "s90-t10" } };
  "s90-t10": { input: { s: 90; t: 10 }; continueWith: { typeName: "s90-t11" } };
  "s90-t11": { input: { s: 90; t: 11 }; continueWith: { typeName: "s90-t12" } };
  "s90-t12": { input: { s: 90; t: 12 }; continueWith: { typeName: "s90-t13" } };
  "s90-t13": { input: { s: 90; t: 13 }; continueWith: { typeName: "s90-t14" } };
  "s90-t14": { input: { s: 90; t: 14 }; continueWith: { typeName: "s90-t15" } };
  "s90-t15": { input: { s: 90; t: 15 }; continueWith: { typeName: "s90-t16" } };
  "s90-t16": { input: { s: 90; t: 16 }; continueWith: { typeName: "s90-t17" } };
  "s90-t17": { input: { s: 90; t: 17 }; continueWith: { typeName: "s90-t18" } };
  "s90-t18": { input: { s: 90; t: 18 }; continueWith: { typeName: "s90-t19" } };
  "s90-t19": { input: { s: 90; t: 19 }; output: { s: 90; done: true } };
}>();

const slice91 = defineJobTypes<{
  "s91-t0": { entry: true; input: { s: 91; t: 0 }; continueWith: { typeName: "s91-t1" } };
  "s91-t1": { input: { s: 91; t: 1 }; continueWith: { typeName: "s91-t2" } };
  "s91-t2": { input: { s: 91; t: 2 }; continueWith: { typeName: "s91-t3" } };
  "s91-t3": { input: { s: 91; t: 3 }; continueWith: { typeName: "s91-t4" } };
  "s91-t4": { input: { s: 91; t: 4 }; continueWith: { typeName: "s91-t5" } };
  "s91-t5": { input: { s: 91; t: 5 }; continueWith: { typeName: "s91-t6" } };
  "s91-t6": { input: { s: 91; t: 6 }; continueWith: { typeName: "s91-t7" } };
  "s91-t7": { input: { s: 91; t: 7 }; continueWith: { typeName: "s91-t8" } };
  "s91-t8": { input: { s: 91; t: 8 }; continueWith: { typeName: "s91-t9" } };
  "s91-t9": { input: { s: 91; t: 9 }; continueWith: { typeName: "s91-t10" } };
  "s91-t10": { input: { s: 91; t: 10 }; continueWith: { typeName: "s91-t11" } };
  "s91-t11": { input: { s: 91; t: 11 }; continueWith: { typeName: "s91-t12" } };
  "s91-t12": { input: { s: 91; t: 12 }; continueWith: { typeName: "s91-t13" } };
  "s91-t13": { input: { s: 91; t: 13 }; continueWith: { typeName: "s91-t14" } };
  "s91-t14": { input: { s: 91; t: 14 }; continueWith: { typeName: "s91-t15" } };
  "s91-t15": { input: { s: 91; t: 15 }; continueWith: { typeName: "s91-t16" } };
  "s91-t16": { input: { s: 91; t: 16 }; continueWith: { typeName: "s91-t17" } };
  "s91-t17": { input: { s: 91; t: 17 }; continueWith: { typeName: "s91-t18" } };
  "s91-t18": { input: { s: 91; t: 18 }; continueWith: { typeName: "s91-t19" } };
  "s91-t19": { input: { s: 91; t: 19 }; output: { s: 91; done: true } };
}>();

const slice92 = defineJobTypes<{
  "s92-t0": { entry: true; input: { s: 92; t: 0 }; continueWith: { typeName: "s92-t1" } };
  "s92-t1": { input: { s: 92; t: 1 }; continueWith: { typeName: "s92-t2" } };
  "s92-t2": { input: { s: 92; t: 2 }; continueWith: { typeName: "s92-t3" } };
  "s92-t3": { input: { s: 92; t: 3 }; continueWith: { typeName: "s92-t4" } };
  "s92-t4": { input: { s: 92; t: 4 }; continueWith: { typeName: "s92-t5" } };
  "s92-t5": { input: { s: 92; t: 5 }; continueWith: { typeName: "s92-t6" } };
  "s92-t6": { input: { s: 92; t: 6 }; continueWith: { typeName: "s92-t7" } };
  "s92-t7": { input: { s: 92; t: 7 }; continueWith: { typeName: "s92-t8" } };
  "s92-t8": { input: { s: 92; t: 8 }; continueWith: { typeName: "s92-t9" } };
  "s92-t9": { input: { s: 92; t: 9 }; continueWith: { typeName: "s92-t10" } };
  "s92-t10": { input: { s: 92; t: 10 }; continueWith: { typeName: "s92-t11" } };
  "s92-t11": { input: { s: 92; t: 11 }; continueWith: { typeName: "s92-t12" } };
  "s92-t12": { input: { s: 92; t: 12 }; continueWith: { typeName: "s92-t13" } };
  "s92-t13": { input: { s: 92; t: 13 }; continueWith: { typeName: "s92-t14" } };
  "s92-t14": { input: { s: 92; t: 14 }; continueWith: { typeName: "s92-t15" } };
  "s92-t15": { input: { s: 92; t: 15 }; continueWith: { typeName: "s92-t16" } };
  "s92-t16": { input: { s: 92; t: 16 }; continueWith: { typeName: "s92-t17" } };
  "s92-t17": { input: { s: 92; t: 17 }; continueWith: { typeName: "s92-t18" } };
  "s92-t18": { input: { s: 92; t: 18 }; continueWith: { typeName: "s92-t19" } };
  "s92-t19": { input: { s: 92; t: 19 }; output: { s: 92; done: true } };
}>();

const slice93 = defineJobTypes<{
  "s93-t0": { entry: true; input: { s: 93; t: 0 }; continueWith: { typeName: "s93-t1" } };
  "s93-t1": { input: { s: 93; t: 1 }; continueWith: { typeName: "s93-t2" } };
  "s93-t2": { input: { s: 93; t: 2 }; continueWith: { typeName: "s93-t3" } };
  "s93-t3": { input: { s: 93; t: 3 }; continueWith: { typeName: "s93-t4" } };
  "s93-t4": { input: { s: 93; t: 4 }; continueWith: { typeName: "s93-t5" } };
  "s93-t5": { input: { s: 93; t: 5 }; continueWith: { typeName: "s93-t6" } };
  "s93-t6": { input: { s: 93; t: 6 }; continueWith: { typeName: "s93-t7" } };
  "s93-t7": { input: { s: 93; t: 7 }; continueWith: { typeName: "s93-t8" } };
  "s93-t8": { input: { s: 93; t: 8 }; continueWith: { typeName: "s93-t9" } };
  "s93-t9": { input: { s: 93; t: 9 }; continueWith: { typeName: "s93-t10" } };
  "s93-t10": { input: { s: 93; t: 10 }; continueWith: { typeName: "s93-t11" } };
  "s93-t11": { input: { s: 93; t: 11 }; continueWith: { typeName: "s93-t12" } };
  "s93-t12": { input: { s: 93; t: 12 }; continueWith: { typeName: "s93-t13" } };
  "s93-t13": { input: { s: 93; t: 13 }; continueWith: { typeName: "s93-t14" } };
  "s93-t14": { input: { s: 93; t: 14 }; continueWith: { typeName: "s93-t15" } };
  "s93-t15": { input: { s: 93; t: 15 }; continueWith: { typeName: "s93-t16" } };
  "s93-t16": { input: { s: 93; t: 16 }; continueWith: { typeName: "s93-t17" } };
  "s93-t17": { input: { s: 93; t: 17 }; continueWith: { typeName: "s93-t18" } };
  "s93-t18": { input: { s: 93; t: 18 }; continueWith: { typeName: "s93-t19" } };
  "s93-t19": { input: { s: 93; t: 19 }; output: { s: 93; done: true } };
}>();

const slice94 = defineJobTypes<{
  "s94-t0": { entry: true; input: { s: 94; t: 0 }; continueWith: { typeName: "s94-t1" } };
  "s94-t1": { input: { s: 94; t: 1 }; continueWith: { typeName: "s94-t2" } };
  "s94-t2": { input: { s: 94; t: 2 }; continueWith: { typeName: "s94-t3" } };
  "s94-t3": { input: { s: 94; t: 3 }; continueWith: { typeName: "s94-t4" } };
  "s94-t4": { input: { s: 94; t: 4 }; continueWith: { typeName: "s94-t5" } };
  "s94-t5": { input: { s: 94; t: 5 }; continueWith: { typeName: "s94-t6" } };
  "s94-t6": { input: { s: 94; t: 6 }; continueWith: { typeName: "s94-t7" } };
  "s94-t7": { input: { s: 94; t: 7 }; continueWith: { typeName: "s94-t8" } };
  "s94-t8": { input: { s: 94; t: 8 }; continueWith: { typeName: "s94-t9" } };
  "s94-t9": { input: { s: 94; t: 9 }; continueWith: { typeName: "s94-t10" } };
  "s94-t10": { input: { s: 94; t: 10 }; continueWith: { typeName: "s94-t11" } };
  "s94-t11": { input: { s: 94; t: 11 }; continueWith: { typeName: "s94-t12" } };
  "s94-t12": { input: { s: 94; t: 12 }; continueWith: { typeName: "s94-t13" } };
  "s94-t13": { input: { s: 94; t: 13 }; continueWith: { typeName: "s94-t14" } };
  "s94-t14": { input: { s: 94; t: 14 }; continueWith: { typeName: "s94-t15" } };
  "s94-t15": { input: { s: 94; t: 15 }; continueWith: { typeName: "s94-t16" } };
  "s94-t16": { input: { s: 94; t: 16 }; continueWith: { typeName: "s94-t17" } };
  "s94-t17": { input: { s: 94; t: 17 }; continueWith: { typeName: "s94-t18" } };
  "s94-t18": { input: { s: 94; t: 18 }; continueWith: { typeName: "s94-t19" } };
  "s94-t19": { input: { s: 94; t: 19 }; output: { s: 94; done: true } };
}>();

const slice95 = defineJobTypes<{
  "s95-t0": { entry: true; input: { s: 95; t: 0 }; continueWith: { typeName: "s95-t1" } };
  "s95-t1": { input: { s: 95; t: 1 }; continueWith: { typeName: "s95-t2" } };
  "s95-t2": { input: { s: 95; t: 2 }; continueWith: { typeName: "s95-t3" } };
  "s95-t3": { input: { s: 95; t: 3 }; continueWith: { typeName: "s95-t4" } };
  "s95-t4": { input: { s: 95; t: 4 }; continueWith: { typeName: "s95-t5" } };
  "s95-t5": { input: { s: 95; t: 5 }; continueWith: { typeName: "s95-t6" } };
  "s95-t6": { input: { s: 95; t: 6 }; continueWith: { typeName: "s95-t7" } };
  "s95-t7": { input: { s: 95; t: 7 }; continueWith: { typeName: "s95-t8" } };
  "s95-t8": { input: { s: 95; t: 8 }; continueWith: { typeName: "s95-t9" } };
  "s95-t9": { input: { s: 95; t: 9 }; continueWith: { typeName: "s95-t10" } };
  "s95-t10": { input: { s: 95; t: 10 }; continueWith: { typeName: "s95-t11" } };
  "s95-t11": { input: { s: 95; t: 11 }; continueWith: { typeName: "s95-t12" } };
  "s95-t12": { input: { s: 95; t: 12 }; continueWith: { typeName: "s95-t13" } };
  "s95-t13": { input: { s: 95; t: 13 }; continueWith: { typeName: "s95-t14" } };
  "s95-t14": { input: { s: 95; t: 14 }; continueWith: { typeName: "s95-t15" } };
  "s95-t15": { input: { s: 95; t: 15 }; continueWith: { typeName: "s95-t16" } };
  "s95-t16": { input: { s: 95; t: 16 }; continueWith: { typeName: "s95-t17" } };
  "s95-t17": { input: { s: 95; t: 17 }; continueWith: { typeName: "s95-t18" } };
  "s95-t18": { input: { s: 95; t: 18 }; continueWith: { typeName: "s95-t19" } };
  "s95-t19": { input: { s: 95; t: 19 }; output: { s: 95; done: true } };
}>();

const slice96 = defineJobTypes<{
  "s96-t0": { entry: true; input: { s: 96; t: 0 }; continueWith: { typeName: "s96-t1" } };
  "s96-t1": { input: { s: 96; t: 1 }; continueWith: { typeName: "s96-t2" } };
  "s96-t2": { input: { s: 96; t: 2 }; continueWith: { typeName: "s96-t3" } };
  "s96-t3": { input: { s: 96; t: 3 }; continueWith: { typeName: "s96-t4" } };
  "s96-t4": { input: { s: 96; t: 4 }; continueWith: { typeName: "s96-t5" } };
  "s96-t5": { input: { s: 96; t: 5 }; continueWith: { typeName: "s96-t6" } };
  "s96-t6": { input: { s: 96; t: 6 }; continueWith: { typeName: "s96-t7" } };
  "s96-t7": { input: { s: 96; t: 7 }; continueWith: { typeName: "s96-t8" } };
  "s96-t8": { input: { s: 96; t: 8 }; continueWith: { typeName: "s96-t9" } };
  "s96-t9": { input: { s: 96; t: 9 }; continueWith: { typeName: "s96-t10" } };
  "s96-t10": { input: { s: 96; t: 10 }; continueWith: { typeName: "s96-t11" } };
  "s96-t11": { input: { s: 96; t: 11 }; continueWith: { typeName: "s96-t12" } };
  "s96-t12": { input: { s: 96; t: 12 }; continueWith: { typeName: "s96-t13" } };
  "s96-t13": { input: { s: 96; t: 13 }; continueWith: { typeName: "s96-t14" } };
  "s96-t14": { input: { s: 96; t: 14 }; continueWith: { typeName: "s96-t15" } };
  "s96-t15": { input: { s: 96; t: 15 }; continueWith: { typeName: "s96-t16" } };
  "s96-t16": { input: { s: 96; t: 16 }; continueWith: { typeName: "s96-t17" } };
  "s96-t17": { input: { s: 96; t: 17 }; continueWith: { typeName: "s96-t18" } };
  "s96-t18": { input: { s: 96; t: 18 }; continueWith: { typeName: "s96-t19" } };
  "s96-t19": { input: { s: 96; t: 19 }; output: { s: 96; done: true } };
}>();

const slice97 = defineJobTypes<{
  "s97-t0": { entry: true; input: { s: 97; t: 0 }; continueWith: { typeName: "s97-t1" } };
  "s97-t1": { input: { s: 97; t: 1 }; continueWith: { typeName: "s97-t2" } };
  "s97-t2": { input: { s: 97; t: 2 }; continueWith: { typeName: "s97-t3" } };
  "s97-t3": { input: { s: 97; t: 3 }; continueWith: { typeName: "s97-t4" } };
  "s97-t4": { input: { s: 97; t: 4 }; continueWith: { typeName: "s97-t5" } };
  "s97-t5": { input: { s: 97; t: 5 }; continueWith: { typeName: "s97-t6" } };
  "s97-t6": { input: { s: 97; t: 6 }; continueWith: { typeName: "s97-t7" } };
  "s97-t7": { input: { s: 97; t: 7 }; continueWith: { typeName: "s97-t8" } };
  "s97-t8": { input: { s: 97; t: 8 }; continueWith: { typeName: "s97-t9" } };
  "s97-t9": { input: { s: 97; t: 9 }; continueWith: { typeName: "s97-t10" } };
  "s97-t10": { input: { s: 97; t: 10 }; continueWith: { typeName: "s97-t11" } };
  "s97-t11": { input: { s: 97; t: 11 }; continueWith: { typeName: "s97-t12" } };
  "s97-t12": { input: { s: 97; t: 12 }; continueWith: { typeName: "s97-t13" } };
  "s97-t13": { input: { s: 97; t: 13 }; continueWith: { typeName: "s97-t14" } };
  "s97-t14": { input: { s: 97; t: 14 }; continueWith: { typeName: "s97-t15" } };
  "s97-t15": { input: { s: 97; t: 15 }; continueWith: { typeName: "s97-t16" } };
  "s97-t16": { input: { s: 97; t: 16 }; continueWith: { typeName: "s97-t17" } };
  "s97-t17": { input: { s: 97; t: 17 }; continueWith: { typeName: "s97-t18" } };
  "s97-t18": { input: { s: 97; t: 18 }; continueWith: { typeName: "s97-t19" } };
  "s97-t19": { input: { s: 97; t: 19 }; output: { s: 97; done: true } };
}>();

const slice98 = defineJobTypes<{
  "s98-t0": { entry: true; input: { s: 98; t: 0 }; continueWith: { typeName: "s98-t1" } };
  "s98-t1": { input: { s: 98; t: 1 }; continueWith: { typeName: "s98-t2" } };
  "s98-t2": { input: { s: 98; t: 2 }; continueWith: { typeName: "s98-t3" } };
  "s98-t3": { input: { s: 98; t: 3 }; continueWith: { typeName: "s98-t4" } };
  "s98-t4": { input: { s: 98; t: 4 }; continueWith: { typeName: "s98-t5" } };
  "s98-t5": { input: { s: 98; t: 5 }; continueWith: { typeName: "s98-t6" } };
  "s98-t6": { input: { s: 98; t: 6 }; continueWith: { typeName: "s98-t7" } };
  "s98-t7": { input: { s: 98; t: 7 }; continueWith: { typeName: "s98-t8" } };
  "s98-t8": { input: { s: 98; t: 8 }; continueWith: { typeName: "s98-t9" } };
  "s98-t9": { input: { s: 98; t: 9 }; continueWith: { typeName: "s98-t10" } };
  "s98-t10": { input: { s: 98; t: 10 }; continueWith: { typeName: "s98-t11" } };
  "s98-t11": { input: { s: 98; t: 11 }; continueWith: { typeName: "s98-t12" } };
  "s98-t12": { input: { s: 98; t: 12 }; continueWith: { typeName: "s98-t13" } };
  "s98-t13": { input: { s: 98; t: 13 }; continueWith: { typeName: "s98-t14" } };
  "s98-t14": { input: { s: 98; t: 14 }; continueWith: { typeName: "s98-t15" } };
  "s98-t15": { input: { s: 98; t: 15 }; continueWith: { typeName: "s98-t16" } };
  "s98-t16": { input: { s: 98; t: 16 }; continueWith: { typeName: "s98-t17" } };
  "s98-t17": { input: { s: 98; t: 17 }; continueWith: { typeName: "s98-t18" } };
  "s98-t18": { input: { s: 98; t: 18 }; continueWith: { typeName: "s98-t19" } };
  "s98-t19": { input: { s: 98; t: 19 }; output: { s: 98; done: true } };
}>();

const slice99 = defineJobTypes<{
  "s99-t0": { entry: true; input: { s: 99; t: 0 }; continueWith: { typeName: "s99-t1" } };
  "s99-t1": { input: { s: 99; t: 1 }; continueWith: { typeName: "s99-t2" } };
  "s99-t2": { input: { s: 99; t: 2 }; continueWith: { typeName: "s99-t3" } };
  "s99-t3": { input: { s: 99; t: 3 }; continueWith: { typeName: "s99-t4" } };
  "s99-t4": { input: { s: 99; t: 4 }; continueWith: { typeName: "s99-t5" } };
  "s99-t5": { input: { s: 99; t: 5 }; continueWith: { typeName: "s99-t6" } };
  "s99-t6": { input: { s: 99; t: 6 }; continueWith: { typeName: "s99-t7" } };
  "s99-t7": { input: { s: 99; t: 7 }; continueWith: { typeName: "s99-t8" } };
  "s99-t8": { input: { s: 99; t: 8 }; continueWith: { typeName: "s99-t9" } };
  "s99-t9": { input: { s: 99; t: 9 }; continueWith: { typeName: "s99-t10" } };
  "s99-t10": { input: { s: 99; t: 10 }; continueWith: { typeName: "s99-t11" } };
  "s99-t11": { input: { s: 99; t: 11 }; continueWith: { typeName: "s99-t12" } };
  "s99-t12": { input: { s: 99; t: 12 }; continueWith: { typeName: "s99-t13" } };
  "s99-t13": { input: { s: 99; t: 13 }; continueWith: { typeName: "s99-t14" } };
  "s99-t14": { input: { s: 99; t: 14 }; continueWith: { typeName: "s99-t15" } };
  "s99-t15": { input: { s: 99; t: 15 }; continueWith: { typeName: "s99-t16" } };
  "s99-t16": { input: { s: 99; t: 16 }; continueWith: { typeName: "s99-t17" } };
  "s99-t17": { input: { s: 99; t: 17 }; continueWith: { typeName: "s99-t18" } };
  "s99-t18": { input: { s: 99; t: 18 }; continueWith: { typeName: "s99-t19" } };
  "s99-t19": { input: { s: 99; t: 19 }; output: { s: 99; done: true } };
}>();

const merge_L0_0 = mergeJobTypeRegistries(
  slice0,
  slice1,
  slice2,
  slice3,
  slice4,
  slice5,
  slice6,
  slice7,
  slice8,
  slice9,
  slice10,
  slice11,
  slice12,
  slice13,
  slice14,
  slice15,
  slice16,
  slice17,
  slice18,
  slice19,
  slice20,
  slice21,
  slice22,
  slice23,
  slice24,
  slice25,
  slice26,
  slice27,
  slice28,
  slice29,
  slice30,
  slice31,
  slice32,
  slice33,
  slice34,
  slice35,
  slice36,
  slice37,
  slice38,
  slice39,
);
const merge_L0_1 = mergeJobTypeRegistries(
  slice40,
  slice41,
  slice42,
  slice43,
  slice44,
  slice45,
  slice46,
  slice47,
  slice48,
  slice49,
  slice50,
  slice51,
  slice52,
  slice53,
  slice54,
  slice55,
  slice56,
  slice57,
  slice58,
  slice59,
  slice60,
  slice61,
  slice62,
  slice63,
  slice64,
  slice65,
  slice66,
  slice67,
  slice68,
  slice69,
  slice70,
  slice71,
  slice72,
  slice73,
  slice74,
  slice75,
  slice76,
  slice77,
  slice78,
  slice79,
);
const merge_L0_2 = mergeJobTypeRegistries(
  slice80,
  slice81,
  slice82,
  slice83,
  slice84,
  slice85,
  slice86,
  slice87,
  slice88,
  slice89,
  slice90,
  slice91,
  slice92,
  slice93,
  slice94,
  slice95,
  slice96,
  slice97,
  slice98,
  slice99,
);

const merge_L1_0 = mergeJobTypeRegistries(merge_L0_0, merge_L0_1, merge_L0_2);

const merged = merge_L1_0;
type MergedDefs = JobTypeRegistryDefinitions<typeof merged>;

// Exercise ChainTypesReaching (triggers ChainReachMap) on a sample of types
// If __slice short-circuit works, this should typecheck quickly even with 2000 types

// Slice 0: entry reaches itself
expectTypeOf<ChainTypesReaching<MergedDefs, "s0-t0">>().toEqualTypeOf<"s0-t0">();
// Slice 0: mid-chain type reached by its entry
expectTypeOf<ChainTypesReaching<MergedDefs, "s0-t10">>().toEqualTypeOf<"s0-t0">();
// Slice 0: terminal type reached by its entry
expectTypeOf<ChainTypesReaching<MergedDefs, "s0-t19">>().toEqualTypeOf<"s0-t0">();

// Slice 25: entry reaches itself
expectTypeOf<ChainTypesReaching<MergedDefs, "s25-t0">>().toEqualTypeOf<"s25-t0">();
// Slice 25: mid-chain type reached by its entry
expectTypeOf<ChainTypesReaching<MergedDefs, "s25-t10">>().toEqualTypeOf<"s25-t0">();
// Slice 25: terminal type reached by its entry
expectTypeOf<ChainTypesReaching<MergedDefs, "s25-t19">>().toEqualTypeOf<"s25-t0">();

// Slice 50: entry reaches itself
expectTypeOf<ChainTypesReaching<MergedDefs, "s50-t0">>().toEqualTypeOf<"s50-t0">();
// Slice 50: mid-chain type reached by its entry
expectTypeOf<ChainTypesReaching<MergedDefs, "s50-t10">>().toEqualTypeOf<"s50-t0">();
// Slice 50: terminal type reached by its entry
expectTypeOf<ChainTypesReaching<MergedDefs, "s50-t19">>().toEqualTypeOf<"s50-t0">();

// Slice 75: entry reaches itself
expectTypeOf<ChainTypesReaching<MergedDefs, "s75-t0">>().toEqualTypeOf<"s75-t0">();
// Slice 75: mid-chain type reached by its entry
expectTypeOf<ChainTypesReaching<MergedDefs, "s75-t10">>().toEqualTypeOf<"s75-t0">();
// Slice 75: terminal type reached by its entry
expectTypeOf<ChainTypesReaching<MergedDefs, "s75-t19">>().toEqualTypeOf<"s75-t0">();

// Slice 99: entry reaches itself
expectTypeOf<ChainTypesReaching<MergedDefs, "s99-t0">>().toEqualTypeOf<"s99-t0">();
// Slice 99: mid-chain type reached by its entry
expectTypeOf<ChainTypesReaching<MergedDefs, "s99-t10">>().toEqualTypeOf<"s99-t0">();
// Slice 99: terminal type reached by its entry
expectTypeOf<ChainTypesReaching<MergedDefs, "s99-t19">>().toEqualTypeOf<"s99-t0">();

// Verify ChainJobTypeNames collects exactly the slice's types
expectTypeOf<ChainJobTypeNames<MergedDefs, "s0-t0">>().toEqualTypeOf<
  | "s0-t0"
  | "s0-t1"
  | "s0-t2"
  | "s0-t3"
  | "s0-t4"
  | "s0-t5"
  | "s0-t6"
  | "s0-t7"
  | "s0-t8"
  | "s0-t9"
  | "s0-t10"
  | "s0-t11"
  | "s0-t12"
  | "s0-t13"
  | "s0-t14"
  | "s0-t15"
  | "s0-t16"
  | "s0-t17"
  | "s0-t18"
  | "s0-t19"
>();

// Verify EntryJobTypeDefinitions sees all 100 entries
expectTypeOf<keyof EntryJobTypeDefinitions<MergedDefs>>().toEqualTypeOf<
  | "s0-t0"
  | "s1-t0"
  | "s2-t0"
  | "s3-t0"
  | "s4-t0"
  | "s5-t0"
  | "s6-t0"
  | "s7-t0"
  | "s8-t0"
  | "s9-t0"
  | "s10-t0"
  | "s11-t0"
  | "s12-t0"
  | "s13-t0"
  | "s14-t0"
  | "s15-t0"
  | "s16-t0"
  | "s17-t0"
  | "s18-t0"
  | "s19-t0"
  | "s20-t0"
  | "s21-t0"
  | "s22-t0"
  | "s23-t0"
  | "s24-t0"
  | "s25-t0"
  | "s26-t0"
  | "s27-t0"
  | "s28-t0"
  | "s29-t0"
  | "s30-t0"
  | "s31-t0"
  | "s32-t0"
  | "s33-t0"
  | "s34-t0"
  | "s35-t0"
  | "s36-t0"
  | "s37-t0"
  | "s38-t0"
  | "s39-t0"
  | "s40-t0"
  | "s41-t0"
  | "s42-t0"
  | "s43-t0"
  | "s44-t0"
  | "s45-t0"
  | "s46-t0"
  | "s47-t0"
  | "s48-t0"
  | "s49-t0"
  | "s50-t0"
  | "s51-t0"
  | "s52-t0"
  | "s53-t0"
  | "s54-t0"
  | "s55-t0"
  | "s56-t0"
  | "s57-t0"
  | "s58-t0"
  | "s59-t0"
  | "s60-t0"
  | "s61-t0"
  | "s62-t0"
  | "s63-t0"
  | "s64-t0"
  | "s65-t0"
  | "s66-t0"
  | "s67-t0"
  | "s68-t0"
  | "s69-t0"
  | "s70-t0"
  | "s71-t0"
  | "s72-t0"
  | "s73-t0"
  | "s74-t0"
  | "s75-t0"
  | "s76-t0"
  | "s77-t0"
  | "s78-t0"
  | "s79-t0"
  | "s80-t0"
  | "s81-t0"
  | "s82-t0"
  | "s83-t0"
  | "s84-t0"
  | "s85-t0"
  | "s86-t0"
  | "s87-t0"
  | "s88-t0"
  | "s89-t0"
  | "s90-t0"
  | "s91-t0"
  | "s92-t0"
  | "s93-t0"
  | "s94-t0"
  | "s95-t0"
  | "s96-t0"
  | "s97-t0"
  | "s98-t0"
  | "s99-t0"
>();
