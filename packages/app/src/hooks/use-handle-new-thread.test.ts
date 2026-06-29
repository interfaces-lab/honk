import { EnvironmentId, ProjectId, ThreadId } from "@honk/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import type { AppRouter } from "~/router";
import { scopedProjectKey, scopeProjectRef } from "../lib/environment-scope";
import { DEFAULT_INTERACTION_MODE } from "../types";
import { useThreadSendIntentStore } from "../stores/thread-send-intent-store";
import { DraftId, useComposerDraftStore, type DraftId as DraftIdType } from "../stores/chat-drafts";
import { openNewThreadWithRouter } from "./use-handle-new-thread";

const environmentId = EnvironmentId.make("environment:new-thread");
const projectId = ProjectId.make("project:new-thread");
const projectRef = scopeProjectRef(environmentId, projectId);
const logicalProjectKey = scopedProjectKey(projectRef);

type DraftNavigateCall = {
  readonly to: "/draft/$draftId";
  readonly params: {
    readonly draftId: DraftIdType;
  };
};

describe("openNewThreadWithRouter", () => {
  beforeEach(() => {
    useComposerDraftStore.persist.clearStorage();
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    });
    useThreadSendIntentStore.getState().resetForTests();
  });

  it("creates a fresh project draft instead of reopening the latest unsent draft", async () => {
    const store = useComposerDraftStore.getState();
    const oldDraftId = DraftId.make(
      `new-thread-draft:project:${environmentId}:${projectId}:existing`,
    );
    const oldThreadId = ThreadId.make("thread:new-thread:existing");
    store.setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, oldDraftId, {
      threadId: oldThreadId,
      createdAt: "2026-06-20T00:00:00.000Z",
      interactionMode: DEFAULT_INTERACTION_MODE,
      envMode: "local",
    });
    store.updateComposerDraft(oldDraftId, {
      prompt: "Keep this older draft",
      richTextJson: '{"type":"doc","content":[]}',
    });

    const navigateCalls: unknown[] = [];
    const router = {
      state: {
        matches: [{ params: {} }],
      },
      navigate: (options: unknown) => {
        navigateCalls.push(options);
      },
    } as unknown as AppRouter;

    await openNewThreadWithRouter(router, projectRef);

    expect(navigateCalls).toHaveLength(1);
    expect(navigateCalls[0]).toMatchObject({
      to: "/draft/$draftId",
    });
    const navigateCall = navigateCalls[0] as DraftNavigateCall;
    const newDraftId = navigateCall.params.draftId;
    expect(newDraftId).not.toBe(oldDraftId);

    const nextStore = useComposerDraftStore.getState();
    const newDraftSession = nextStore.getDraftSession(newDraftId);
    expect(newDraftSession).not.toBeNull();
    expect(newDraftSession?.threadId).not.toBe(oldThreadId);
    expect(newDraftId.endsWith(`:${newDraftSession?.threadId ?? ""}`)).toBe(true);
    expect(Object.keys(nextStore.draftThreadsByThreadKey)).toEqual(
      expect.arrayContaining([oldDraftId, newDraftId]),
    );
    expect(nextStore.getComposerDraft(oldDraftId)?.prompt).toBe("Keep this older draft");
    expect(nextStore.getComposerDraft(newDraftId)?.prompt ?? "").toBe("");
    expect(nextStore.getDraftSessionByLogicalProjectKey(logicalProjectKey)?.draftId).toBe(
      newDraftId,
    );
  });
});
