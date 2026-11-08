/**
 * Job Type Registry Measurement: superjson codec adapter
 */

import { createSuperjsonJobTypes } from "example-codec-superjson/adapter";

import { type OrderJobTypes, runValidationBenchmark } from "./validation.ts";

await runValidationBenchmark({
  name: "validation-codec-superjson",
  title: "JOB TYPES: SUPERJSON CODEC",
  jobTypes: createSuperjsonJobTypes<OrderJobTypes>({ "process-order": true }),
});
