import type {
  LocationInfo as OpenCodeLocationInfo,
  SessionV2Info as OpenCodeSessionInfo,
} from "@opencode-ai/sdk/v2/client";
import { describe, expect, it, vi } from "vitest";

import type { OpenCodeClient } from "./client";
import { createOpenCodeServer } from "./identity";
import {
  OPEN_CODE_LOCAL_SESSION_TARGET,
  OPEN_CODE_NEW_WORKSPACE_SESSION_TARGET,
  createOpenCodeTargetedSession,
  openCodeProjectCopyParent,
  resolveOpenCodeProjectDirectories,
} from "./project-copy";

function location(
  directory: string,
  projectID = "abcdef123456",
  projectDirectory = directory,
): OpenCodeLocationInfo {
  return {
    directory,
    project: { id: projectID, directory: projectDirectory },
  };
}

function session(directory: string): OpenCodeSessionInfo {
  return {
    id: "ses_created",
    projectID: "abcdef123456",
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    time: { created: 1, updated: 1 },
    title: "New session",
    location: { directory },
  };
}

describe("OpenCode project copies", () => {
  it("places server-managed copies beside the project on Unix and Windows", () => {
    expect(openCodeProjectCopyParent(location("/Users/me/Developer/honk"))).toBe(
      "/Users/me/Developer/.opencode/worktree/abcdef",
    );
    expect(openCodeProjectCopyParent(location("C:\\Users\\me\\Developer\\honk"))).toBe(
      "C:\\Users\\me\\Developer\\.opencode\\worktree\\abcdef",
    );
  });

  it("keeps the resolved directory for a global local session", async () => {
    const createSession = vi.fn(() => Promise.resolve(session("/Users/me/Documents")));
    const client = {
      server: createOpenCodeServer({ origin: "http://opencode.test" }),
      resolveLocation: vi.fn(() => Promise.resolve(location("/Users/me/Documents", "global", "/"))),
      sessions: { create: createSession },
    } as unknown as OpenCodeClient;

    await createOpenCodeTargetedSession(client, {
      source: { directory: "/Users/me/Documents" },
      target: OPEN_CODE_LOCAL_SESSION_TARGET,
    });

    expect(createSession).toHaveBeenCalledWith({
      location: { directory: "/Users/me/Documents" },
    });
  });

  it("creates the worktree before the session through one client boundary", async () => {
    const copyDirectory = "/Users/me/Developer/.opencode/worktree/abcdef/quiet-river";
    const createCopy = vi.fn(() => Promise.resolve({ directory: copyDirectory }));
    const removeCopy = vi.fn(() => Promise.resolve());
    const createSession = vi.fn(() => Promise.resolve(session(copyDirectory)));
    const client = {
      server: createOpenCodeServer({ origin: "http://opencode.test" }),
      resolveLocation: vi.fn(() => Promise.resolve(location("/Users/me/Developer/honk"))),
      projectCopies: { create: createCopy, remove: removeCopy },
      sessions: { create: createSession },
    } as unknown as OpenCodeClient;

    await expect(
      createOpenCodeTargetedSession(client, {
        source: { directory: "/Users/me/Developer/honk" },
        target: OPEN_CODE_NEW_WORKSPACE_SESSION_TARGET,
      }),
    ).resolves.toMatchObject({ id: "ses_created", location: { directory: copyDirectory } });

    expect(createCopy).toHaveBeenCalledWith({
      projectID: "abcdef123456",
      location: { directory: "/Users/me/Developer/honk" },
      strategy: "git_worktree",
      directory: "/Users/me/Developer/.opencode/worktree/abcdef",
    });
    expect(createSession).toHaveBeenCalledWith({ location: { directory: copyDirectory } });
    expect(removeCopy).not.toHaveBeenCalled();
  });

  it("removes a newly created worktree when session creation fails", async () => {
    const copyDirectory = "/Users/me/Developer/.opencode/worktree/abcdef/quiet-river";
    const removeCopy = vi.fn(() => Promise.resolve());
    const client = {
      server: createOpenCodeServer({ origin: "http://opencode.test" }),
      resolveLocation: vi.fn(() => Promise.resolve(location("/Users/me/Developer/honk"))),
      projectCopies: {
        create: vi.fn(() => Promise.resolve({ directory: copyDirectory })),
        remove: removeCopy,
      },
      sessions: { create: vi.fn(() => Promise.reject(new Error("session failed"))) },
    } as unknown as OpenCodeClient;

    await expect(
      createOpenCodeTargetedSession(client, {
        source: { directory: "/Users/me/Developer/honk" },
        target: OPEN_CODE_NEW_WORKSPACE_SESSION_TARGET,
      }),
    ).rejects.toThrow("session failed");
    expect(removeCopy).toHaveBeenCalledWith({
      projectID: "abcdef123456",
      location: { directory: "/Users/me/Developer/honk" },
      directory: copyDirectory,
      force: false,
    });
  });

  it("resolves project roots canonically and falls back to session history", async () => {
    const resolveLocation = vi
      .fn()
      .mockResolvedValueOnce(
        location("/deleted/honk-copy", "project-1", "/Users/me/Developer/honk"),
      )
      .mockRejectedValueOnce(new Error("deleted directory"));
    const client = {
      resolveLocation,
    } as unknown as OpenCodeClient;

    const directories = await resolveOpenCodeProjectDirectories(client, [
      { projectID: "project-1", location: { directory: "/deleted/honk-copy" } },
      { projectID: "missing", location: { directory: "/Users/me/Developer/missing" } },
    ]);

    expect([...directories]).toEqual([
      ["project-1", "/Users/me/Developer/honk"],
      ["missing", "/Users/me/Developer/missing"],
    ]);
    expect(resolveLocation).toHaveBeenNthCalledWith(1, { directory: "/deleted/honk-copy" });
    expect(resolveLocation).toHaveBeenNthCalledWith(2, {
      directory: "/Users/me/Developer/missing",
    });
  });
});
