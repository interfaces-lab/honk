import { EnvironmentId, ProjectId, ThreadId } from "@honk/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { scopeProjectRef, scopeThreadRef, scopedThreadKey } from "~/lib/environment-scope";
import { newThreadId } from "~/lib/utils";
import { DEFAULT_INTERACTION_MODE } from "~/types";
import { DraftId as DraftIdSchema, useComposerDraftStore } from "../../../stores/chat-drafts";
import {
  composerDraftTargetKey,
  forceComposerSync,
  getComposerForceSyncGeneration,
  subscribeComposerForceSync,
} from "./use-composer-input-model";

const environmentId = EnvironmentId.make("environment:composer-clear");
const projectId = ProjectId.make("project:composer-clear");

function resetComposerDraftStore(): void {
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
  });
}

describe("composer clear contract", () => {
  beforeEach(() => {
    useComposerDraftStore.persist.clearStorage();
    resetComposerDraftStore();
  });

  it("clearComposerContent and forceComposerSync empty SSOT and bump editor sync generation", () => {
    const threadRef = scopeThreadRef(environmentId, ThreadId.make("thread:composer-clear"));
    const targetKey = composerDraftTargetKey(threadRef);
    const store = useComposerDraftStore.getState();
    const listener = vi.fn();

    subscribeComposerForceSync(targetKey, listener);
    store.updateComposerDraft(threadRef, {
      prompt: "Follow-up prompt",
      richTextJson: '{"type":"doc","content":[]}',
    });

    expect(store.getComposerDraft(threadRef)?.prompt).toBe("Follow-up prompt");

    store.clearComposerContent(threadRef);
    forceComposerSync(targetKey);

    expect(store.getComposerDraft(threadRef)).toBeNull();
    expect(getComposerForceSyncGeneration(targetKey)).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("restore path repopulates draft after optimistic clear", () => {
    const projectRef = scopeProjectRef(environmentId, projectId);
    const draftId = DraftIdSchema.make(`new-thread-draft:project:${environmentId}:${projectId}`);
    const threadId = newThreadId();
    const store = useComposerDraftStore.getState();

    store.setLogicalProjectDraftThreadId("git:/tmp/composer-clear", projectRef, draftId, {
      threadId,
      createdAt: new Date().toISOString(),
      interactionMode: DEFAULT_INTERACTION_MODE,
      envMode: "local",
    });

    store.updateComposerDraft(draftId, {
      prompt: "Retry me",
      richTextJson: '{"type":"doc"}',
    });
    store.clearComposerText(draftId);
    expect(store.getComposerDraft(draftId)).toBeNull();

    store.updateComposerDraft(draftId, {
      prompt: "Retry me",
      richTextJson: '{"type":"doc"}',
    });
    forceComposerSync(composerDraftTargetKey(draftId));

    expect(store.getComposerDraft(draftId)?.prompt).toBe("Retry me");
    expect(getComposerForceSyncGeneration(composerDraftTargetKey(draftId))).toBe(1);
  });

  it("uses scoped thread keys for real thread targets", () => {
    const threadRef = scopeThreadRef(environmentId, ThreadId.make("thread:scoped-key"));
    expect(composerDraftTargetKey(threadRef)).toBe(scopedThreadKey(threadRef));
  });

  it("bumps force sync generation and notifies subscribers per target key", () => {
    const targetKey = "thread:composer-force-sync";
    const listener = vi.fn();

    expect(getComposerForceSyncGeneration(targetKey)).toBe(0);

    const unsubscribe = subscribeComposerForceSync(targetKey, listener);
    const nextGeneration = forceComposerSync(targetKey);

    expect(nextGeneration).toBe(1);
    expect(getComposerForceSyncGeneration(targetKey)).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);

    forceComposerSync(targetKey);
    expect(getComposerForceSyncGeneration(targetKey)).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    forceComposerSync(targetKey);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps force sync generations isolated by target key", () => {
    forceComposerSync("thread:a");
    forceComposerSync("thread:a");
    forceComposerSync("thread:b");

    expect(getComposerForceSyncGeneration("thread:a")).toBe(2);
    expect(getComposerForceSyncGeneration("thread:b")).toBe(1);
    expect(getComposerForceSyncGeneration("thread:c")).toBe(0);
  });
});
