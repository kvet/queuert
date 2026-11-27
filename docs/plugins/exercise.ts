import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type TutorialDatabase,
  databaseFile,
  tutorialDatabases,
} from "../src/components/tutorial/databases.ts";
import { examplesDirectory } from "./tsx-pages.ts";

export const tutorialDirectory = (examples: string = examplesDirectory): string =>
  join(examples, "tutorial/src");

export type Exercise = {
  lesson: string;
  /** The files the reader starts from, `index.ts` first, without `db.ts`. */
  start: Record<string, string>;
  /** The same files, solved. */
  solution: Record<string, string>;
  /** The `db.ts` that opens each database, from `examples/tutorial/src/db/<database>.ts`. */
  databases: Record<TutorialDatabase, string>;
  check: string;
  /** Every file read, for the dev server to watch. */
  sources: string[];
};

const readFiles = (directory: string, sources: string[]) => {
  const names = readdirSync(directory)
    .filter((name) => name.endsWith(".ts") && name !== databaseFile)
    .sort((a, b) => Number(b === "index.ts") - Number(a === "index.ts") || a.localeCompare(b));
  return Object.fromEntries(
    names.map((name) => {
      const path = join(directory, name);
      sources.push(path);
      return [name, readFileSync(path, "utf8")];
    }),
  );
};

/** Lists the lessons under `examples/tutorial/src/`: the directories with a `check.ts`. */
export const listExercises = (examples?: string): string[] =>
  readdirSync(tutorialDirectory(examples), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(tutorialDirectory(examples), entry.name, "check.ts")),
    )
    .map((entry) => entry.name)
    .sort();

/**
 * Reads `examples/tutorial/src/<lesson>/`: `start/` and `solution/` hold the same file names with
 * `index.ts` among them, and `check.ts` exports the lesson's check. Both folders keep a `db.ts`
 * that re-exports `src/db/postgres.ts`, so the lesson runs under Node; the docs swap it for the
 * `db.ts` of the reader's database.
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
  for (const folder of ["start", "solution"]) {
    if (!existsSync(join(directory, folder, databaseFile))) {
      throw new Error(`Exercise ${lesson}: ${folder}/ has no ${databaseFile}`);
    }
  }
  const databases = Object.fromEntries(
    tutorialDatabases.map(({ id }) => {
      const path = join(tutorialDirectory(examples), "db", `${id}.ts`);
      sources.push(path);
      return [id, readFileSync(path, "utf8")];
    }),
  ) as Record<TutorialDatabase, string>;
  return { lesson, start, solution, databases, check, sources };
};
