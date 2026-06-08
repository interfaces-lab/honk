import { EnvironmentId, ProjectId, ThreadId } from "@multi/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { scopeThreadRef } from "~/lib/environment-scope";
import {
  DraftId,
  useComposerDraftStore,
  type DraftThreadState,
} from "~/stores/chat-drafts";
import { DEFAULT_INTERACTION_MODE } from "~/types";
import { openChatIndex, openDraft, openThread } from "./chat-navigation";

const environmentId = EnvironmentId.make("environment:test");
const projectId = ProjectId.make("project:test");
const threadId = ThreadId.make("thread:test");
const draftThreadId = ThreadId.make(
  `new-thread-draft:thread:project:${environmentId}:${projectId}`,
);
const draftId = DraftId.make(`new-thread-draft:project:${environmentId}:${projectId}`);
const draftRouteId = DraftId.make("draft:test");

function draftThreadState(): DraftThreadState {
  return {
    threadId: draftThreadId,
    environmentId,
    projectId,
    logicalProjectKey: "git:/repo",
    createdAt: "2026-06-08T00:00:00.000Z",
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    envMode: "local",
    promotedTo: null,
  };
}

beforeEach(() => {
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
  });
});

describe("chat navigation", () => {
  it("opens server thread routes with branded params", () => {
    const calls: unknown[] = [];
    const navigate = (options: unknown) => {
      calls.push(options);
    };

    openThread(navigate, scopeThreadRef(environmentId, threadId), { replace: true });

    expect(calls).toEqual([
      {
        to: "/$environmentId/$threadId",
        params: {
          environmentId,
          threadId,
        },
        replace: true,
      },
    ]);
  });

  it("opens draft routes with branded params", () => {
    const calls: unknown[] = [];
    const navigate = (options: unknown) => {
      calls.push(options);
    };

    openDraft(navigate, draftRouteId);

    expect(calls).toEqual([
      {
        to: "/draft/$draftId",
        params: {
          draftId: draftRouteId,
        },
      },
    ]);
  });

  it("redirects pre-thread urls to draft routes while the draft session is active", () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadKey: {
        [draftId]: draftThreadState(),
      },
    });
    const calls: unknown[] = [];
    const navigate = (options: unknown) => {
      calls.push(options);
    };

    openThread(navigate, scopeThreadRef(environmentId, draftThreadId), { replace: true });

    expect(calls).toEqual([
      {
        to: "/draft/$draftId",
        params: {
          draftId,
        },
        replace: true,
      },
    ]);
  });

  it("opens the chat index with replace when requested", () => {
    const calls: unknown[] = [];
    const navigate = (options: unknown) => {
      calls.push(options);
    };

    openChatIndex(navigate, { replace: true });

    expect(calls).toEqual([
      {
        to: "/",
        replace: true,
      },
    ]);
  });
});
