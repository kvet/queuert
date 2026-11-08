import { JobTypeValidationError } from "../errors.ts";
import type { ObservabilityHelper } from "../observability-adapter/observability-helper.ts";
import { type JobTypes, definitionsSymbol, externalDefinitionsSymbol } from "./job-types.ts";

export const wrapJobTypesWithLogging = <TJobTypeDefinitions>({
  jobTypes,
  observabilityHelper,
}: {
  jobTypes: JobTypes<TJobTypeDefinitions>;
  observabilityHelper: ObservabilityHelper;
}): JobTypes<TJobTypeDefinitions> => {
  const wrap = <T extends (...args: never[]) => unknown>(fn: T): T =>
    ((...args) => {
      try {
        return fn(...args);
      } catch (error) {
        if (error instanceof JobTypeValidationError) {
          observabilityHelper.jobTypeValidationError(error);
        }
        throw error;
      }
    }) as T;

  return {
    getTypeNames: () => jobTypes.getTypeNames(),
    validateEntry: wrap(jobTypes.validateEntry),
    encodeInput: wrap(jobTypes.encodeInput),
    decodeInput: wrap(jobTypes.decodeInput),
    encodeOutput: wrap(jobTypes.encodeOutput),
    decodeOutput: wrap(jobTypes.decodeOutput),
    validateContinueWith: wrap(jobTypes.validateContinueWith),
    validateBlockers: wrap(jobTypes.validateBlockers),
    [definitionsSymbol]: jobTypes[definitionsSymbol],
    [externalDefinitionsSymbol]: jobTypes[externalDefinitionsSymbol],
  };
};
