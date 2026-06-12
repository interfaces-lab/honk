import { describe, expect, it } from "vitest";

import { deriveGitPanelViewState } from "./use-environment-git";

const emptyStatus = {
  data: null,
  error: null,
  isPending: false,
};

describe("deriveGitPanelViewState", () => {
  it("shows loading while waiting for Git status", () => {
    expect(
      deriveGitPanelViewState({
        cwd: "/repo",
        status: {
          data: null,
          error: null,
          isPending: true,
        },
      }),
    ).toEqual({ kind: "loading" });
  });

  it("stays idle when no workspace cwd is available", () => {
    expect(
      deriveGitPanelViewState({
        cwd: null,
        status: emptyStatus,
      }),
    ).toEqual({ kind: "idle" });
  });
});
