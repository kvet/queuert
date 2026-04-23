import { JobTypeValidationError } from "../errors.js";
import { type ObservabilityHelper } from "../observability-adapter/observability-helper.js";
import { type JobTypes, definitionsSymbol, externalDefinitionsSymbol } from "./job-types.js";

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
    parseInput: wrap(jobTypes.parseInput),
    parseOutput: wrap(jobTypes.parseOutput),
    validateContinueWith: wrap(jobTypes.validateContinueWith),
    validateBlockers: wrap(jobTypes.validateBlockers),
    [definitionsSymbol]: jobTypes[definitionsSymbol],
    [externalDefinitionsSymbol]: jobTypes[externalDefinitionsSymbol],
  };
};
