import { EnvironmentId, ProjectId, ThreadId } from "@multi/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { scopeProjectRef, scopeThreadRef, scopedThreadKey } from "../lib/environment-scope";
import { newThreadId } from "../lib/utils";
import { DEFAULT_INTERACTION_MODE } from "../types";
import {
  type DraftId,
  DraftId as DraftIdSchema,
  finalizePromotedDraftThreadByRef,
  isNewThreadDraftId,
  draftIdFromNewThreadDraftThreadId,
  isNewThreadDraftThreadId,
  useComposerDraftStore,
} from "./chat-drafts";

type FlushablePersistStorage = {
  flush?: () => void;
};

const environmentId = EnvironmentId.make("environment:chat-drafts");
const projectId = ProjectId.make("project:chat-drafts");
const logicalProjectKey = "git:/Users/workgyver/Developer/multi";

function resetComposerDraftStore(): void {
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
  });
}

function flushComposerDraftStorage(): void {
  const storage = useComposerDraftStore.persist.getOptions().storage as
    | FlushablePersistStorage
    | undefined;
  storage?.flush?.();
}

function openProjectNewThreadDraft(projectRef: ReturnType<typeof scopeProjectRef>): {
  draftId: DraftId;
  threadId: ThreadId;
} {
  const store = useComposerDraftStore.getState();
  const draftId = DraftIdSchema.make(
    `new-thread-draft:project:${projectRef.environmentId}:${projectRef.projectId}`,
  );
  const threadId = newThreadId();
  store.setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, draftId, {
    threadId,
    createdAt: new Date().toISOString(),
    interactionMode: DEFAULT_INTERACTION_MODE,
    envMode: "local",
  });
  return { draftId, threadId };
}

describe("chat drafts", () => {
  beforeEach(() => {
    useComposerDraftStore.persist.clearStorage();
    resetComposerDraftStore();
  });

  it("keeps a promoted new-thread draft through persistence until the promoted thread route finalizes it", async () => {
    const projectRef = scopeProjectRef(environmentId, projectId);
    const draft = openProjectNewThreadDraft(projectRef);
    const promotedThreadRef = scopeThreadRef(
      environmentId,
      ThreadId.make("thread:chat-drafts:promoted"),
    );

    expect(isNewThreadDraftId(draft.draftId)).toBe(true);
    expect(isNewThreadDraftThreadId(draft.threadId)).toBe(false);

    useComposerDraftStore.getState().setPrompt(draft.draftId, "Implement git-action draft reload");
    useComposerDraftStore.getState().markDraftThreadPromoting(draft.draftId, promotedThreadRef);
    flushComposerDraftStorage();

    resetComposerDraftStore();
    await useComposerDraftStore.persist.rehydrate();

    expect(useComposerDraftStore.getState().getDraftSession(draft.draftId)?.promotedTo).toEqual(
      promotedThreadRef,
    );
    expect(
      useComposerDraftStore.getState().getDraftSessionByLogicalProjectKey(logicalProjectKey),
    ).toBeNull();
    expect(useComposerDraftStore.getState().getDraftSessionByProjectRef(projectRef)).toBeNull();
    expect(
      useComposerDraftStore.getState().logicalProjectDraftThreadKeyByLogicalProjectKey[
        logicalProjectKey
      ],
    ).toBe(draft.draftId);
    expect(useComposerDraftStore.getState().getComposerDraft(draft.draftId)?.prompt).toBe(
      "Implement git-action draft reload",
    );

    const unrelatedThreadRef = scopeThreadRef(
      environmentId,
      ThreadId.make("thread:chat-drafts:unrelated"),
    );
    expect(finalizePromotedDraftThreadByRef(unrelatedThreadRef)).toEqual([]);
    expect(useComposerDraftStore.getState().getDraftSession(draft.draftId)).not.toBeNull();

    expect(finalizePromotedDraftThreadByRef(promotedThreadRef)).toEqual([
      scopeThreadRef(environmentId, draft.threadId),
    ]);
    expect(finalizePromotedDraftThreadByRef(promotedThreadRef)).toEqual([]);
    expect(useComposerDraftStore.getState().getDraftSession(draft.draftId)).toBeNull();
    expect(useComposerDraftStore.getState().getComposerDraft(draft.draftId)).toBeNull();
    expect(
      Object.values(useComposerDraftStore.getState().logicalProjectDraftThreadKeyByLogicalProjectKey),
    ).not.toContain(draft.draftId satisfies DraftId);
    expect(useComposerDraftStore.getState().listDraftThreadKeys()).not.toContain(
      scopedThreadKey(scopeThreadRef(environmentId, draft.threadId)),
    );
  });
});
