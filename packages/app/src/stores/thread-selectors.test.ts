import { EnvironmentId } from "@honk/shared/environment";
import { ProjectId, ThreadId } from "@honk/shared/base-schemas";
import { describe, expect, it } from "vitest";

import { scopeThreadRef } from "~/lib/environment-scope";
import { initialEnvironmentState, type AppState } from "./thread-store";
import { createThreadSelectorByRef } from "./thread-selectors";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";

const environmentId = EnvironmentId.make("environment:thread-selectors");
const threadId = ThreadId.make("thread:thread-selectors");
const projectId = ProjectId.make("project:thread-selectors");
const threadRef = scopeThreadRef(environmentId, threadId);
const createdAt = "2026-06-06T00:00:00.000Z";

function appStateWithThreadShell(): AppState {
  return {
    activeEnvironmentId: environmentId,
    environmentStateById: {
      [environmentId]: {
        ...initialEnvironmentState,
        threadIds: [threadId],
        threadShellById: {
          [threadId]: {
            id: threadId,
            environmentId,
            codexThreadId: null,
            projectId,
            title: "Thread selectors",
            modelSelection: {
              instanceId: "codex",
              model: "gpt-5.5",
            },
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_INTERACTION_MODE,
            error: null,
            createdAt,
            archivedAt: null,
            branch: null,
            worktreePath: null,
          },
        },
      },
    },
  };
}

describe("createThreadSelectorByRef", () => {
  it("does not return a cached thread after the shell is removed from the environment state", () => {
    const selector = createThreadSelectorByRef(threadRef);
    const withThread = appStateWithThreadShell();
    const environmentState = withThread.environmentStateById[environmentId];
    if (!environmentState) {
      throw new Error("Expected environment state");
    }

    expect(selector(withThread)).toBeDefined();

    const withoutThread = {
      ...withThread,
      environmentStateById: {
        [environmentId]: {
          ...environmentState,
          threadIds: [],
          threadShellById: {},
        },
      },
    };

    expect(selector(withoutThread)).toBeUndefined();
  });

  it("does not return a cached thread when the shell disappears from the same environment state object", () => {
    const selector = createThreadSelectorByRef(threadRef);
    const withThread = appStateWithThreadShell();
    const environmentState = withThread.environmentStateById[environmentId];
    if (!environmentState) {
      throw new Error("Expected environment state");
    }

    expect(selector(withThread)).toBeDefined();

    delete environmentState.threadShellById[threadId];
    environmentState.threadIds = [];

    expect(selector(withThread)).toBeUndefined();
  });
});
