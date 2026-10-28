import { cp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const flattenStaticOutput = async (publicDirectory: string, base: string) => {
  const mounted = join(publicDirectory, base);
  for (const entry of await readdir(mounted)) {
    await rm(join(publicDirectory, entry), { recursive: true, force: true });
    await cp(join(mounted, entry), join(publicDirectory, entry), { recursive: true });
  }
  await rm(mounted, { recursive: true, force: true });
  await rename(join(publicDirectory, "404", "index.html"), join(publicDirectory, "404.html"));
  await rm(join(publicDirectory, "404"), { recursive: true, force: true });
  await writeFile(join(publicDirectory, ".nojekyll"), "");
};
