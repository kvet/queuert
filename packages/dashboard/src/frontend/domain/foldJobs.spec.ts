import { describe, expect, it } from "vitest";

import { continuedJob, tailJob, runningChain, runningJob } from "./fixtures.spec-helper.js";
import { foldJobs } from "./foldJobs.js";

const shape = (entries: ReturnType<typeof foldJobs>) =>
  entries.map((entry) =>
    entry.kind === "job" ? entry.job.id : `fold(${entry.jobs.map((job) => job.id).join(",")})`,
  );

describe("foldJobs", () => {
  it("does not fold fewer than three repeats", () => {
    const jobs = [continuedJob("a"), continuedJob("b"), tailJob("c")];

    expect(shape(foldJobs(jobs, {}))).toEqual(["a", "b", "c"]);
  });

  it("folds three or more consecutive continued jobs of the same type", () => {
    const jobs = [continuedJob("a"), continuedJob("b"), continuedJob("c"), tailJob("d")];

    const entries = foldJobs(jobs, {});

    expect(shape(entries)).toEqual(["fold(a,b,c)", "d"]);
    expect(entries[0]).toMatchObject({ kind: "fold", typeName: "work" });
  });

  it("never folds the tail job, a running job, or a type change", () => {
    const jobs = [
      continuedJob("a"),
      continuedJob("b"),
      continuedJob("c", { typeName: "other" }),
      continuedJob("d", { typeName: "other" }),
      runningJob({ id: "e" }),
    ];

    expect(shape(foldJobs(jobs, {}))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("breaks a run at a job that has blockers", () => {
    const jobs = ["a", "b", "c", "d", "e", "f", "g"].map((id) => continuedJob(id));

    const entries = foldJobs(jobs, { d: [runningChain("dep")], e: [] });

    expect(shape(entries)).toEqual(["fold(a,b,c)", "d", "fold(e,f,g)"]);
  });

  it("re-folds across a page boundary once the next page is appended", () => {
    const firstPage = [continuedJob("a"), continuedJob("b")];
    const secondPage = [continuedJob("c"), tailJob("d")];

    expect(shape(foldJobs(firstPage, {}))).toEqual(["a", "b"]);
    expect(shape(foldJobs([...firstPage, ...secondPage], {}))).toEqual(["fold(a,b,c)", "d"]);
  });
});
