import * as chains from "./functions/chains.ts";
import * as jobs from "./functions/jobs.ts";
import * as workers from "./functions/workers.ts";

export const serverFns: typeof chains & typeof jobs & typeof workers = {
  ...chains,
  ...jobs,
  ...workers,
};
