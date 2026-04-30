import { describe, expect, it } from "vitest";

import { type DiffRow, syncRows } from "./use-environment-git";

function row(id: string, part?: Partial<DiffRow>) {
  return {
    id,
    path: id,
    prevPath: null,
    state: "modified",
    staged: false,
    unstaged: true,
    add: 1,
    del: 0,
    ...part,
  } satisfies DiffRow;
}

describe("syncRows", () => {
  it("keeps unchanged rows cached", () => {
    const out = syncRows([row("a")], [row("a")]);

    expect([...out.ids]).toEqual(["a"]);
    expect([...out.drop]).toEqual([]);
  });

  it("invalidates changed rows only", () => {
    const out = syncRows([row("a"), row("b")], [row("a", { add: 2 }), row("b")]);

    expect([...out.ids]).toEqual(["a", "b"]);
    expect([...out.drop]).toEqual(["a"]);
  });

  it("does not invalidate brand new rows", () => {
    const out = syncRows([], [row("a")]);

    expect([...out.ids]).toEqual(["a"]);
    expect([...out.drop]).toEqual([]);
  });
});
