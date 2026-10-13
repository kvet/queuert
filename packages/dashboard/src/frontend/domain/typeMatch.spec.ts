import { describe, expect, it } from "vitest";

import { matchTypeNames, scoreTypeName } from "./typeMatch.js";

describe("type name matching", () => {
  const names = ["order:validate", "greet", "order:process", "fetch-user", "user-greeting"];

  it("matches letters in order, anywhere in the name", () => {
    expect(matchTypeNames(names, "ordval")).toEqual(["order:validate"]);
    expect(matchTypeNames(names, "fchusr")).toEqual(["fetch-user"]);
    expect(scoreTypeName("order:validate", "vo")).toBeUndefined();
  });

  it("ranks word starts and runs of letters above scattered letters", () => {
    expect(matchTypeNames(["unsuper", "pre-user"], "user")).toEqual(["pre-user", "unsuper"]);
    expect(matchTypeNames(["unscheduled-run", "sched-run"], "sr")).toEqual([
      "sched-run",
      "unscheduled-run",
    ]);
  });

  it("prefers the shorter name when scores tie", () => {
    expect(matchTypeNames(["greet-all", "greet"], "greet")).toEqual(["greet", "greet-all"]);
  });

  it("requires every whitespace-separated term, in any order", () => {
    expect(matchTypeNames(names, "val ord")).toEqual(["order:validate"]);
    expect(matchTypeNames(names, "order greet")).toEqual([]);
  });

  it("is case-sensitive only when the term has an uppercase letter", () => {
    expect(matchTypeNames(["OrderPlaced", "orderplaced"], "op")).toHaveLength(2);
    expect(matchTypeNames(["OrderPlaced", "orderplaced"], "OP")).toEqual(["OrderPlaced"]);
  });

  it("caps the matches at the limit", () => {
    expect(matchTypeNames(names, "e", 2)).toHaveLength(2);
  });

  it("matches nothing for empty text", () => {
    expect(matchTypeNames(names, "  ")).toEqual([]);
  });

  it("keeps the given order when score and length tie", () => {
    expect(matchTypeNames(["foo_bar", "foo-bar"], "fb")).toEqual(["foo_bar", "foo-bar"]);
    expect(matchTypeNames(["foo-bar", "foo_bar"], "fb")).toEqual(["foo-bar", "foo_bar"]);
  });

  it("ranks camel-case humps and digits above letters inside a word", () => {
    expect(matchTypeNames(["unpack", "userPack"], "up")).toEqual(["userPack", "unpack"]);
    expect(matchTypeNames(["user2fa", "userzfa"], "u2")).toEqual(["user2fa"]);
  });

  it("scores names whose lowercase form is longer without shifting positions", () => {
    expect(scoreTypeName("İmport-job", "j")).toBe(scoreTypeName("import-job", "j"));
  });
});
