import { isThenable, silence } from "./maybe-promise.ts";
import { decode, startSteps, type Steps, syncStep, withResources } from "./steps.ts";

export const dynamicSyncAsync =
  <TArgs extends unknown[], TResult>(
    body: (...args: TArgs) => Steps<TResult>,
  ): ((...args: TArgs) => Promise<TResult>) =>
  async (...args) =>
    withResources(async (resources) => {
      let sync: boolean | undefined;
      let violation: { error: unknown } | undefined;
      try {
        const steps = body(...args);
        let result = startSteps(steps);
        while (result.done !== true) {
          const instruction = decode(result.value);
          let next: { value: unknown } | { error: unknown };
          try {
            if (instruction.kind === "wait") {
              next = { value: await instruction.value };
            } else if (instruction.kind === "resource") {
              const value = resources.use(await instruction.value);
              if (value !== null && value !== undefined) {
                sync ??= typeof value === "object" && "sync" in value && value.sync === true;
              }
              next = { value };
            } else if (sync === false && isThenable(instruction.value)) {
              next = { value: await instruction.value };
            } else {
              try {
                if (sync === undefined) {
                  throw new Error("A step ran before the first resource, so the body has no mode");
                }
                if (!sync) {
                  throw new Error(
                    "An asynchronous step got a plain value: the value must be a promise",
                  );
                }
                next = { value: syncStep(instruction.value) };
              } catch (error) {
                if (isThenable(instruction.value)) silence(instruction.value);
                violation ??= { error };
                throw error;
              }
            }
          } catch (error) {
            next = { error };
          }
          result = "error" in next ? steps.throw(next.error) : steps.next(next.value);
        }
        if (violation !== undefined) throw violation.error;
        return result.value;
      } catch (error) {
        throw violation === undefined ? error : violation.error;
      }
    });
