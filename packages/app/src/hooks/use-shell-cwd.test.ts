import { describe, expect, it } from "vitest";

import { resolveShellCwd } from "./use-shell-cwd";

describe("resolveShellCwd", () => {
  it("prefers the active thread project over a stale stored workspace", () => {
    const cwd = resolveShellCwd({
      projects: [
        { id: "project-a", cwd: "/repo/a" },
        { id: "project-b", cwd: "/repo/b" },
      ],
      threads: [{ id: "thread-a", projectId: "project-a", worktreePath: null }],
      routeThreadId: "thread-a",
      stored: "/repo/b",
    });

    expect(cwd).toBe("/repo/a");
  });

  it("prefers a thread worktree path when present", () => {
    const cwd = resolveShellCwd({
      projects: [{ id: "project-a", cwd: "/repo/a" }],
      threads: [{ id: "thread-a", projectId: "project-a", worktreePath: "/repo/a-worktree" }],
      routeThreadId: "thread-a",
      stored: "/repo/a",
    });

    expect(cwd).toBe("/repo/a-worktree");
  });

  it("falls back to the stored workspace when no thread is active", () => {
    const cwd = resolveShellCwd({
      projects: [
        { id: "project-a", cwd: "/repo/a" },
        { id: "project-b", cwd: "/repo/b" },
      ],
      threads: [],
      routeThreadId: null,
      stored: "/repo/b",
    });

    expect(cwd).toBe("/repo/b");
  });
});
