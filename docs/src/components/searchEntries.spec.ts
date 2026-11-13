import MiniSearch from "minisearch";
import { describe, expect, it } from "vitest";

import { createSearchIndex, fetchSearchEntries } from "./searchEntries.ts";

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

describe("createSearchIndex", () => {
  const searchEntry = (id: number, section: string, title: string, text: string) => ({
    id,
    title,
    heading: "",
    section,
    href: `/page-${id}/`,
    text,
  });

  it("ignores filler words in a query", () => {
    const index = createSearchIndex(MiniSearch, [
      searchEntry(
        0,
        "Docs · Guides",
        "Error Handling",
        "A failed job attempt is rescheduled; other queues call this a retry.",
      ),
      searchEntry(1, "Blog · Posts", "Finishing a job", "How to commit a job with your writes."),
    ]);

    expect(index.search("how to retry a failed job").map((result) => result.title)).toEqual([
      "Error Handling",
    ]);
  });

  it("ranks a guide above an API reference entry that matches the same way", () => {
    const index = createSearchIndex(MiniSearch, [
      searchEntry(0, "API · @queuert/postgres", "Postgres", "Postgres state adapter."),
      searchEntry(1, "Integrations · State Adapters", "Postgres", "Postgres state adapter."),
    ]);

    expect(index.search("postgres").map((result) => result.section)).toEqual([
      "Integrations · State Adapters",
      "API · @queuert/postgres",
    ]);
  });
});
