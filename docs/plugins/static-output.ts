import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const finishStaticOutput = async (publicDirectory: string) => {
  await rename(join(publicDirectory, "404", "index.html"), join(publicDirectory, "404.html"));
  await rm(join(publicDirectory, "404"), { recursive: true, force: true });
  await writeFile(join(publicDirectory, ".nojekyll"), "");
};
