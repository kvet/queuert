import { describe, expect, it } from "vitest";

import { fetchSearchEntries } from "./searchEntries.ts";

const entry = {
  id: 0,
  title: "Scheduling",
  heading: "",
  section: "Docs · Guides",
  href: "/guides/scheduling/",
  text: "Start a chain later.",
};

describe("fetchSearchEntries", () => {
  it("returns the entries of a successful response", async () => {
    const entries = await fetchSearchEntries("/queuert/search.json", async (url) => {
      expect(url).toBe("/queuert/search.json");
      return Response.json([entry]);
    });

    expect(entries).toEqual([entry]);
  });

  it("rejects on an HTTP error instead of parsing the error page", async () => {
    await expect(
      fetchSearchEntries(
        "/queuert/search.json",
        async () => new Response("<!doctype html>Not found", { status: 404 }),
      ),
    ).rejects.toThrow("HTTP 404");
  });

  it("rejects when the request itself fails", async () => {
    await expect(
      fetchSearchEntries("/queuert/search.json", async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).rejects.toThrow("Failed to fetch");
  });
});
