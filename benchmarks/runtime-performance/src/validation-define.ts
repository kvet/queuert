/**
 * Job Type Registry Measurement: `defineJobTypes` baseline (no runtime validation)
 */

import { defineJobTypes } from "queuert";

import { type OrderJobTypes, runValidationBenchmark } from "./validation.ts";

await runValidationBenchmark({
  name: "validation-define",
  title: "JOB TYPES: DEFINEJOBTYPES (BASELINE)",
  jobTypes: defineJobTypes<OrderJobTypes>(),
});
