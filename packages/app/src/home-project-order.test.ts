import { describe, expect, it } from "vitest";

import { buildHomeProjectDrop, mergeHomeProjectOrder } from "./home-project-order";

const projects = ["a", "b", "c"].map((key) => ({ key }));

describe("home project order", () => {
  it("applies persisted ranks and leaves new projects in derived order", () => {
    expect(
      mergeHomeProjectOrder(projects, ["c", "stale", "a"]).map((project) => project.key),
    ).toEqual(["c", "a", "b"]);
  });

  it("keeps a pinned row ahead of persisted project ranks", () => {
    expect(
      mergeHomeProjectOrder([{ key: "all" }, ...projects], ["all", "c", "a"]).map(
        (project) => project.key,
      ),
    ).toEqual(["all", "c", "a", "b"]);
  });

  it("moves projects before and after visible anchors", () => {
    expect(
      buildHomeProjectDrop({
        projects,
        rankedKeys: [],
        sourceKey: "a",
        anchorKey: "c",
        dropAfter: false,
        cap: 50,
      }),
    ).toEqual(["b", "a", "c"]);
    expect(
      buildHomeProjectDrop({
        projects,
        rankedKeys: [],
        sourceKey: "a",
        anchorKey: "c",
        dropAfter: true,
        cap: 50,
      }),
    ).toEqual(["b", "c", "a"]);
  });

  it("retains stale ranks under the cap and evicts the oldest stale rank past it", () => {
    expect(
      buildHomeProjectDrop({
        projects,
        rankedKeys: ["stale", "a"],
        sourceKey: "c",
        anchorKey: "a",
        dropAfter: false,
        cap: 50,
      }),
    ).toEqual(["stale", "c", "a", "b"]);
    expect(
      buildHomeProjectDrop({
        projects,
        rankedKeys: ["stale-old", "stale-new", "a"],
        sourceKey: "c",
        anchorKey: "a",
        dropAfter: true,
        cap: 4,
      }),
    ).toEqual(["stale-new", "a", "c", "b"]);
  });

  it("leaves the order unchanged for an invalid drop", () => {
    expect(
      buildHomeProjectDrop({
        projects,
        rankedKeys: ["c", "a", "b"],
        sourceKey: "missing",
        anchorKey: "a",
        dropAfter: false,
        cap: 50,
      }),
    ).toEqual(["c", "a", "b"]);
  });
});
