import { scopeProjectRef } from "@multi/client-runtime";
import { EnvironmentId, ProjectId } from "@multi/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  resolveThreadActionProjectRef,
  startNewLocalThreadFromContext,
  startNewThreadInProjectFromContext,
  startNewThreadFromContext,
  type ChatThreadActionContext,
} from "./chat-thread-actions";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const PROJECT_ID = ProjectId.make("project-1");
const FALLBACK_PROJECT_ID = ProjectId.make("project-2");

function createContext(overrides: Partial<ChatThreadActionContext> = {}): ChatThreadActionContext {
  return {
    activeDraftThread: null,
    activeThread: undefined,
    defaultProjectRef: scopeProjectRef(ENVIRONMENT_ID, FALLBACK_PROJECT_ID),
    defaultThreadEnvMode: "local",
    handleNewThread: async () => {},
    ...overrides,
  };
}

describe("chatThreadActions", () => {
  it("prefers the active draft thread project when resolving thread actions", () => {
    const projectRef = resolveThreadActionProjectRef(
      createContext({
        activeDraftThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          branch: "feature/refactor",
          worktreePath: "/tmp/worktree",
          envMode: "worktree",
        },
      }),
    );

    expect(projectRef).toEqual(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID));
  });

  it("falls back to the default project ref when there is no active thread context", () => {
    const projectRef = resolveThreadActionProjectRef(
      createContext({
        defaultProjectRef: scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID),
      }),
    );

    expect(projectRef).toEqual(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID));
  });

  it("starts a contextual new thread from the active draft thread", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});

    const didStart = await startNewThreadFromContext(
      createContext({
        activeDraftThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          branch: "feature/refactor",
          worktreePath: "/tmp/worktree",
          envMode: "worktree",
        },
        handleNewThread,
      }),
    );

    expect(didStart).toBe(true);
    expect(handleNewThread).toHaveBeenCalledWith(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), {
      branch: "feature/refactor",
      worktreePath: "/tmp/worktree",
      envMode: "worktree",
    });
  });

  it("starts a local thread with the configured default env mode", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});

    const didStart = await startNewLocalThreadFromContext(
      createContext({
        defaultProjectRef: scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID),
        defaultThreadEnvMode: "worktree",
        handleNewThread,
      }),
    );

    expect(didStart).toBe(true);
    expect(handleNewThread).toHaveBeenCalledWith(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), {
      envMode: "worktree",
    });
  });

  it("starts a project thread in default worktree mode without inheriting active context", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});
    const projectRef = scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID);

    await startNewThreadInProjectFromContext(
      createContext({
        activeDraftThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          branch: "feature/draft",
          worktreePath: "/repo/.multi/worktrees/draft",
          envMode: "worktree",
        },
        activeThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          branch: "feature/existing",
          worktreePath: "/repo/.multi/worktrees/existing",
        },
        defaultThreadEnvMode: "worktree",
        handleNewThread,
      }),
      projectRef,
    );

    expect(handleNewThread).toHaveBeenCalledWith(projectRef, {
      envMode: "worktree",
      reuseExistingDraft: false,
    });
  });

  it("starts a project thread from the active server thread context", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});
    const projectRef = scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID);

    await startNewThreadInProjectFromContext(
      createContext({
        activeThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          branch: "effect-atom",
          worktreePath: null,
        },
        handleNewThread,
      }),
      projectRef,
    );

    expect(handleNewThread).toHaveBeenCalledWith(projectRef, {
      branch: "effect-atom",
      worktreePath: null,
      envMode: "local",
      reuseExistingDraft: false,
    });
  });

  it("starts a project thread from the matching active draft context first", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});
    const projectRef = scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID);

    await startNewThreadInProjectFromContext(
      createContext({
        activeDraftThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          branch: "feature/new-draft",
          worktreePath: "/repo/worktree",
          envMode: "worktree",
        },
        activeThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          branch: "effect-atom",
          worktreePath: null,
        },
        handleNewThread,
      }),
      projectRef,
    );

    expect(handleNewThread).toHaveBeenCalledWith(projectRef, {
      branch: "feature/new-draft",
      worktreePath: "/repo/worktree",
      envMode: "worktree",
      reuseExistingDraft: false,
    });
  });

  it("starts a project thread with the default mode when active context belongs elsewhere", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});
    const projectRef = scopeProjectRef(ENVIRONMENT_ID, FALLBACK_PROJECT_ID);

    await startNewThreadInProjectFromContext(
      createContext({
        activeThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          branch: "effect-atom",
          worktreePath: null,
        },
        defaultThreadEnvMode: "worktree",
        handleNewThread,
      }),
      projectRef,
    );

    expect(handleNewThread).toHaveBeenCalledWith(projectRef, {
      envMode: "worktree",
      reuseExistingDraft: false,
    });
  });

  it("does not start a thread when there is no project context", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});

    const didStart = await startNewThreadFromContext(
      createContext({
        defaultProjectRef: null,
        handleNewThread,
      }),
    );

    expect(didStart).toBe(false);
    expect(handleNewThread).not.toHaveBeenCalled();
  });
});
