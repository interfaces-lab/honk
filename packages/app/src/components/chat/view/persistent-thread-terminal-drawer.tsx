import type { ScopedThreadRef, ThreadId } from "@multi/contracts";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@multi/shared/project-scripts";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useComposerDraftStore } from "../../../stores/chat-drafts";
import { readEnvironmentApi } from "../../../environment-api";
import { selectThreadWorkspaceSurfaceByRef } from "../../../stores/thread-selectors";
import { selectThreadTerminalState, useTerminalStateStore } from "../../../terminal-state-store";
import { selectProjectsAcrossEnvironments, useStore } from "../../../stores/thread-store";
import { randomUUID } from "~/lib/utils";
import ThreadTerminalDrawer from "../../thread-terminal-drawer";
import { findWorkspaceProjectForSource } from "~/lib/workspace-target";

export interface TerminalLaunchContext {
  threadId: ThreadId;
  cwd: string;
  worktreePath: string | null;
}

export function PersistentThreadTerminalDrawer(props: {
  threadRef: ScopedThreadRef;
  threadId: ThreadId;
  visible: boolean;
  launchContext: Pick<TerminalLaunchContext, "cwd" | "worktreePath"> | null;
  focusRequestId: number;
  splitShortcutLabel: string | undefined;
  newShortcutLabel: string | undefined;
  closeShortcutLabel: string | undefined;
}) {
  const {
    threadRef,
    threadId,
    visible,
    launchContext,
    focusRequestId,
    splitShortcutLabel,
    newShortcutLabel,
    closeShortcutLabel,
  } = props;
  const serverThread = useStore(
    useShallow((store) => selectThreadWorkspaceSurfaceByRef(store, threadRef) ?? null),
  );
  const draftThread = useComposerDraftStore((store) => store.getDraftThreadByRef(threadRef));
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const project = findWorkspaceProjectForSource(projects, serverThread ?? draftThread);
  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadKey, threadRef),
  );
  const storeSetTerminalHeight = useTerminalStateStore((state) => state.setTerminalHeight);
  const storeSplitTerminal = useTerminalStateStore((state) => state.splitTerminal);
  const storeNewTerminal = useTerminalStateStore((state) => state.newTerminal);
  const storeSetActiveTerminal = useTerminalStateStore((state) => state.setActiveTerminal);
  const storeCloseTerminal = useTerminalStateStore((state) => state.closeTerminal);
  const [localFocusRequestId, setLocalFocusRequestId] = useState(0);
  const worktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const effectiveWorktreePath = launchContext !== null ? launchContext.worktreePath : worktreePath;
  const cwd =
    launchContext?.cwd ??
    (project
      ? projectScriptCwd({
          project: { cwd: project.cwd },
          worktreePath: effectiveWorktreePath,
        })
      : null);
  const runtimeEnv = project
    ? projectScriptRuntimeEnv({
        project: { cwd: project.cwd },
        worktreePath: effectiveWorktreePath,
      })
    : {};

  const bumpFocusRequestId = () => {
    if (!visible) {
      return;
    }
    setLocalFocusRequestId((value) => value + 1);
  };

  const setTerminalHeight = (height: number) => {
    storeSetTerminalHeight(threadRef, height);
  };

  const splitTerminal = () => {
    storeSplitTerminal(threadRef, `terminal-${randomUUID()}`);
    bumpFocusRequestId();
  };

  const createNewTerminal = () => {
    storeNewTerminal(threadRef, `terminal-${randomUUID()}`);
    bumpFocusRequestId();
  };

  const activateTerminal = (terminalId: string) => {
    storeSetActiveTerminal(threadRef, terminalId);
    bumpFocusRequestId();
  };

  const closeTerminal = (terminalId: string) => {
    const api = readEnvironmentApi(threadRef.environmentId);
    if (!api) return;
    const isFinalTerminal = terminalState.terminalIds.length <= 1;
    const fallbackExitWrite = () =>
      api.terminal.write({ threadId, terminalId, data: "exit\n" }).catch(() => undefined);

    if ("close" in api.terminal && typeof api.terminal.close === "function") {
      void (async () => {
        if (isFinalTerminal) {
          await api.terminal.clear({ threadId, terminalId }).catch(() => undefined);
        }
        await api.terminal.close({
          threadId,
          terminalId,
          deleteHistory: true,
        });
      })().catch(() => fallbackExitWrite());
    } else {
      void fallbackExitWrite();
    }

    storeCloseTerminal(threadRef, terminalId);
    bumpFocusRequestId();
  };

  if (!project || !terminalState.terminalOpen || !cwd) {
    return null;
  }

  return (
    <div className={visible ? undefined : "hidden"}>
      <ThreadTerminalDrawer
        threadRef={threadRef}
        threadId={threadId}
        cwd={cwd}
        worktreePath={effectiveWorktreePath}
        runtimeEnv={runtimeEnv}
        visible={visible}
        height={terminalState.terminalHeight}
        terminalIds={terminalState.terminalIds}
        activeTerminalId={terminalState.activeTerminalId}
        terminalGroups={terminalState.terminalGroups}
        activeTerminalGroupId={terminalState.activeTerminalGroupId}
        focusRequestId={focusRequestId + localFocusRequestId + (visible ? 1 : 0)}
        onSplitTerminal={splitTerminal}
        onNewTerminal={createNewTerminal}
        splitShortcutLabel={visible ? splitShortcutLabel : undefined}
        newShortcutLabel={visible ? newShortcutLabel : undefined}
        closeShortcutLabel={visible ? closeShortcutLabel : undefined}
        onActiveTerminalChange={activateTerminal}
        onCloseTerminal={closeTerminal}
        onHeightChange={setTerminalHeight}
      />
    </div>
  );
}
