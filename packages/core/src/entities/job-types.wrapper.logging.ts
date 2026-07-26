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
  const reportIfValidationError = (error: unknown): void => {
    if (error instanceof JobTypeValidationError) {
      observabilityHelper.jobTypeValidationError(error);
    }
  };

  const wrapSync = <T extends (...args: never[]) => unknown>(fn: T): T =>
    ((...args) => {
      try {
        return fn(...args);
      } catch (error) {
        reportIfValidationError(error);
        throw error;
      }
    }) as T;

  const wrapAsync = <T extends (...args: never[]) => Promise<unknown>>(fn: T): T =>
    (async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        reportIfValidationError(error);
        throw error;
      }
    }) as T;

  return {
    getTypeNames: () => jobTypes.getTypeNames(),
    validateEntry: wrapSync(jobTypes.validateEntry),
    encode: wrapAsync(jobTypes.encode),
    decode: wrapAsync(jobTypes.decode),
    validateContinueWith: wrapSync(jobTypes.validateContinueWith),
    validateBlockers: wrapSync(jobTypes.validateBlockers),
    [definitionsSymbol]: jobTypes[definitionsSymbol],
    [externalDefinitionsSymbol]: jobTypes[externalDefinitionsSymbol],
  };
};
