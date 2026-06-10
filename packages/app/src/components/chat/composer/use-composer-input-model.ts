import { useCallback, useEffect, useState } from "react";

import {
  type ComposerDraftContentPatch,
  type ComposerThreadTarget,
  useComposerDraftStore,
  useComposerThreadDraft,
} from "../../../stores/chat-drafts";
import { scopedThreadKey } from "~/lib/environment-scope";

type ForceSyncListener = () => void;

const forceSyncGenerationByTargetKey = new Map<string, number>();
const forceSyncListenersByTargetKey = new Map<string, Set<ForceSyncListener>>();

export function getComposerForceSyncGeneration(targetKey: string): number {
  return forceSyncGenerationByTargetKey.get(targetKey) ?? 0;
}

export function forceComposerSync(targetKey: string): number {
  const nextGeneration = getComposerForceSyncGeneration(targetKey) + 1;
  forceSyncGenerationByTargetKey.set(targetKey, nextGeneration);
  const listeners = forceSyncListenersByTargetKey.get(targetKey);
  if (listeners) {
    for (const listener of listeners) {
      listener();
    }
  }
  return nextGeneration;
}

export function subscribeComposerForceSync(
  targetKey: string,
  listener: ForceSyncListener,
): () => void {
  let listeners = forceSyncListenersByTargetKey.get(targetKey);
  if (!listeners) {
    listeners = new Set();
    forceSyncListenersByTargetKey.set(targetKey, listeners);
  }
  listeners.add(listener);
  return () => {
    const currentListeners = forceSyncListenersByTargetKey.get(targetKey);
    if (!currentListeners) {
      return;
    }
    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      forceSyncListenersByTargetKey.delete(targetKey);
    }
  };
}

export function composerDraftTargetKey(target: ComposerThreadTarget): string {
  return typeof target === "string" ? target : scopedThreadKey(target);
}

export function useComposerInputModel(target: ComposerThreadTarget) {
  const targetKey = composerDraftTargetKey(target);
  const draft = useComposerThreadDraft(target);
  const updateComposerDraft = useComposerDraftStore((store) => store.updateComposerDraft);
  const clearComposerText = useComposerDraftStore((store) => store.clearComposerText);
  const [forceSyncGeneration, setForceSyncGeneration] = useState(() =>
    getComposerForceSyncGeneration(targetKey),
  );

  useEffect(() => {
    setForceSyncGeneration(getComposerForceSyncGeneration(targetKey));
    return subscribeComposerForceSync(targetKey, () => {
      setForceSyncGeneration(getComposerForceSyncGeneration(targetKey));
    });
  }, [targetKey]);

  const updateDraft = useCallback(
    (patch: ComposerDraftContentPatch) => {
      updateComposerDraft(target, patch);
    },
    [target, updateComposerDraft],
  );

  const clearDraftText = useCallback(() => {
    clearComposerText(target);
    forceComposerSync(targetKey);
  }, [clearComposerText, target, targetKey]);

  const requestForceSync = useCallback(() => {
    forceComposerSync(targetKey);
  }, [targetKey]);

  return {
    targetKey,
    prompt: draft.prompt,
    richTextJson: draft.richTextJson,
    updateDraft,
    clearDraftText,
    forceSyncGeneration,
    requestForceSync,
  };
}
