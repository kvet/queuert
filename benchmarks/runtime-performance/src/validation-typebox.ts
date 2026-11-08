/**
 * Job Type Registry Measurement: TypeBox
 */

import { Type } from "@sinclair/typebox";
import { createTypeBoxJobTypes } from "example-validation-typebox/adapter";

import { runValidationBenchmark } from "./validation.ts";

await runValidationBenchmark({
  name: "validation-typebox",
  title: "JOB TYPES: TYPEBOX",
  jobTypes: createTypeBoxJobTypes({
    "process-order": {
      entry: true,
      input: Type.Object({
        orderId: Type.String(),
        customer: Type.Object({
          id: Type.String(),
          email: Type.String({ pattern: "^[^@]+@[^@]+$" }),
          name: Type.String(),
        }),
        items: Type.Array(
          Type.Object({ sku: Type.String(), quantity: Type.Integer(), price: Type.Number() }),
        ),
        note: Type.Optional(Type.String()),
      }),
      output: Type.Object({ processed: Type.Boolean(), total: Type.Number() }),
    },
  }),
});
