import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { examplesDirectory } from "./tsx-pages.ts";

export const tutorialDirectory = (examples: string = examplesDirectory): string =>
  join(examples, "tutorial/src");

export type Exercise = {
  lesson: string;
  /** The files the reader starts from, `index.ts` first. */
  start: Record<string, string>;
  /** The same files, solved. */
  solution: Record<string, string>;
  check: string;
  /** Every file read, for the dev server to watch. */
  sources: string[];
};

const readFiles = (directory: string, sources: string[]) => {
  const names = readdirSync(directory)
    .filter((name) => name.endsWith(".ts"))
    .sort((a, b) => Number(b === "index.ts") - Number(a === "index.ts") || a.localeCompare(b));
  return Object.fromEntries(
    names.map((name) => {
      const path = join(directory, name);
      sources.push(path);
      return [name, readFileSync(path, "utf8")];
    }),
  );
};

/** Lists the lessons under `examples/tutorial/src/`, one directory each. */
export const listExercises = (examples?: string): string[] =>
  readdirSync(tutorialDirectory(examples), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

/**
 * Reads `examples/tutorial/src/<lesson>/`: `start/` and `solution/` hold the same file names with
 * `index.ts` among them, and `check.ts` exports the lesson's check.
 */
export const readExercise = (lesson: string, examples?: string): Exercise => {
  if (!/^[a-z0-9-]+$/.test(lesson)) throw new Error(`Exercise lesson "${lesson}" is not a slug`);
  const directory = join(tutorialDirectory(examples), lesson);
  const sources: string[] = [];
  const start = readFiles(join(directory, "start"), sources);
  const solution = readFiles(join(directory, "solution"), sources);
  const checkPath = join(directory, "check.ts");
  sources.push(checkPath);
  const check = readFileSync(checkPath, "utf8");
  if (!("index.ts" in start)) throw new Error(`Exercise ${lesson}: start/ has no index.ts`);
  const startNames = Object.keys(start).join(", ");
  const solutionNames = Object.keys(solution).join(", ");
  if (startNames !== solutionNames) {
    throw new Error(
      `Exercise ${lesson}: start/ (${startNames}) and solution/ (${solutionNames}) differ`,
    );
  }
  return { lesson, start, solution, check, sources };
};
