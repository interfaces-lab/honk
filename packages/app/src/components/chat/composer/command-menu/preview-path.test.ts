import { describe, expect, it } from "vitest";

import { previewPathFullDirectory, splitPathStaircase } from "./preview-path";

describe("splitPathStaircase", () => {
  it("keeps shallow file paths intact with no collapse", () => {
    expect(splitPathStaircase("src/utils/helpers.ts", "file")).toEqual({
      collapsedPrefix: null,
      suffixPath: "src/utils/helpers.ts",
      rowCount: 3,
    });
  });

  it("keeps exactly four ancestor directories without collapsing", () => {
    expect(splitPathStaircase("a/b/c/d/file.ts", "file")).toEqual({
      collapsedPrefix: null,
      suffixPath: "a/b/c/d/file.ts",
      rowCount: 5,
    });
  });

  it("collapses ancestors beyond the last four into the prefix", () => {
    expect(splitPathStaircase("a/b/c/d/e/f/file.ts", "file")).toEqual({
      collapsedPrefix: "a/b",
      suffixPath: "c/d/e/f/file.ts",
      rowCount: 5,
    });
  });

  it("collapses a single extra ancestor into a one-segment prefix", () => {
    expect(splitPathStaircase("a/b/c/d/e/file.ts", "file")).toEqual({
      collapsedPrefix: "a",
      suffixPath: "b/c/d/e/file.ts",
      rowCount: 5,
    });
  });

  it("renders single-segment file paths as a lone leaf row", () => {
    expect(splitPathStaircase("file.ts", "file")).toEqual({
      collapsedPrefix: null,
      suffixPath: "file.ts",
      rowCount: 1,
    });
  });

  it("gives directory leaves pierre's canonical trailing slash", () => {
    expect(splitPathStaircase("a/b/c", "directory")).toEqual({
      collapsedPrefix: null,
      suffixPath: "a/b/c/",
      rowCount: 3,
    });
  });

  it("does not double the trailing slash when directory input already has one", () => {
    expect(splitPathStaircase("a/b/c/", "directory")).toEqual({
      collapsedPrefix: null,
      suffixPath: "a/b/c/",
      rowCount: 3,
    });
  });

  it("renders single-segment directories with a trailing slash", () => {
    expect(splitPathStaircase("src", "directory")).toEqual({
      collapsedPrefix: null,
      suffixPath: "src/",
      rowCount: 1,
    });
  });

  it("collapses deep directory paths and keeps the leaf trailing slash", () => {
    expect(splitPathStaircase("a/b/c/d/e/f/g", "directory")).toEqual({
      collapsedPrefix: "a/b",
      suffixPath: "c/d/e/f/g/",
      rowCount: 5,
    });
  });

  it("normalizes windows separators before splitting", () => {
    expect(splitPathStaircase("a\\b\\c\\file.ts", "file")).toEqual({
      collapsedPrefix: null,
      suffixPath: "a/b/c/file.ts",
      rowCount: 4,
    });
  });

  it("collapses deep windows-separated paths", () => {
    expect(splitPathStaircase("a\\b\\c\\d\\e\\f\\file.ts", "file")).toEqual({
      collapsedPrefix: "a/b",
      suffixPath: "c/d/e/f/file.ts",
      rowCount: 5,
    });
  });

  it("returns an empty staircase for separator-only input", () => {
    expect(splitPathStaircase("/", "file")).toEqual({
      collapsedPrefix: null,
      suffixPath: "",
      rowCount: 0,
    });
  });

  it("drops empty segments from doubled separators", () => {
    expect(splitPathStaircase("a//b/file.ts", "file")).toEqual({
      collapsedPrefix: null,
      suffixPath: "a/b/file.ts",
      rowCount: 3,
    });
  });
});

describe("previewPathFullDirectory", () => {
  it("returns the full ancestor chain for nested paths", () => {
    expect(previewPathFullDirectory("a/b/c/d/e/f.txt")).toBe("a/b/c/d/e");
  });

  it("returns null for single-segment paths", () => {
    expect(previewPathFullDirectory("file.ts")).toBeNull();
  });

  it("treats trailing-slash directories as their own leaf", () => {
    expect(previewPathFullDirectory("a/b/c/")).toBe("a/b");
  });

  it("normalizes windows separators", () => {
    expect(previewPathFullDirectory("a\\b\\file.ts")).toBe("a/b");
  });

  it("returns null for empty input", () => {
    expect(previewPathFullDirectory("")).toBeNull();
  });
});
