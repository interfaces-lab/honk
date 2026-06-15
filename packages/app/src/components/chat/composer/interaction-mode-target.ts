import type { AgentInteractionMode } from "@honk/contracts";

import type { ComposerInteractionModeFocusMode } from "./input-contract";

export interface ComposerInteractionModeTarget {
  readonly id: string;
  readonly isFocused: () => boolean;
  readonly focus: (focusMode?: ComposerInteractionModeFocusMode) => void;
  readonly setInteractionMode: (
    mode: AgentInteractionMode,
    focusMode?: ComposerInteractionModeFocusMode,
  ) => void;
  readonly cycleInteractionMode: (focusMode?: ComposerInteractionModeFocusMode) => void;
}

interface RegisteredComposerInteractionModeTarget extends ComposerInteractionModeTarget {
  readonly order: number;
}

let targetOrder = 0;
const composerInteractionModeTargets = new Map<string, RegisteredComposerInteractionModeTarget>();

export function registerComposerInteractionModeTarget(
  target: ComposerInteractionModeTarget,
): () => void {
  const registeredTarget: RegisteredComposerInteractionModeTarget = {
    ...target,
    order: ++targetOrder,
  };
  composerInteractionModeTargets.set(target.id, registeredTarget);
  return () => {
    if (composerInteractionModeTargets.get(target.id) === registeredTarget) {
      composerInteractionModeTargets.delete(target.id);
    }
  };
}

export function resolveComposerInteractionModeTarget(
  targetId?: string | null,
): ComposerInteractionModeTarget | null {
  if (targetId) {
    return composerInteractionModeTargets.get(targetId) ?? null;
  }
  return (
    resolveFocusedComposerInteractionModeTarget() ?? resolveDefaultComposerInteractionModeTarget()
  );
}

export function hasFocusedComposerInteractionModeTarget(): boolean {
  return resolveFocusedComposerInteractionModeTarget() !== null;
}

export function setFocusedComposerInteractionMode(
  mode: AgentInteractionMode,
  options?: { readonly focusMode?: ComposerInteractionModeFocusMode },
): boolean {
  const target = resolveComposerInteractionModeTarget();
  if (!target) {
    return false;
  }
  target.setInteractionMode(mode, options?.focusMode ?? "preserve");
  return true;
}

export function cycleFocusedComposerInteractionMode(options?: {
  readonly focusMode?: ComposerInteractionModeFocusMode;
}): boolean {
  const target = resolveComposerInteractionModeTarget();
  if (!target) {
    return false;
  }
  target.cycleInteractionMode(options?.focusMode ?? "preserve");
  return true;
}

function resolveFocusedComposerInteractionModeTarget(): ComposerInteractionModeTarget | null {
  const targets = [...composerInteractionModeTargets.values()].toSorted(
    (left, right) => right.order - left.order,
  );
  return targets.find((target) => target.isFocused()) ?? null;
}

function resolveDefaultComposerInteractionModeTarget(): ComposerInteractionModeTarget | null {
  const targets = [...composerInteractionModeTargets.values()].toSorted(
    (left, right) => right.order - left.order,
  );
  return targets[0] ?? null;
}
