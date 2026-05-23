import { ThreadId, type ThreadEntryId } from "@multi/contracts";
import { useCallback, useMemo, useState } from "react";

import { useRouteThreadId } from "~/hooks/use-route-thread-id";
import { readEnvironmentApi } from "~/environment-api";
import { newCommandId } from "~/lib/utils";
import { useStore } from "~/stores/thread-store";
import { createThreadSelectorAcrossEnvironments } from "~/stores/thread-selectors";
import { ThreadTreePanel } from "~/components/chat/view/thread-tree-panel";

export function ThreadTreeDevtoolsPanel() {
  const routeThreadId = useRouteThreadId();
  const activeThreadId = routeThreadId ? ThreadId.make(routeThreadId) : null;
  const thread = useStore(
    useMemo(() => createThreadSelectorAcrossEnvironments(activeThreadId), [activeThreadId]),
  );
  const [selectedEntryId, setSelectedEntryId] = useState<ThreadEntryId | null>(null);

  const onActivate = useCallback(
    (entryId: ThreadEntryId) => {
      if (!thread) {
        return;
      }
      setSelectedEntryId(entryId);
      const api = readEnvironmentApi(thread.environmentId);
      if (!api) {
        return;
      }
      void api.orchestration
        .dispatchCommand({
          type: "thread.tree.navigate",
          commandId: newCommandId(),
          threadId: thread.id,
          entryId,
          createdAt: new Date().toISOString(),
        })
        .catch((error: unknown) => {
          console.warn("[ThreadTreeDevtoolsPanel] tree navigation failed", error);
        });
    },
    [thread],
  );

  if (!thread) {
    return (
      <div className="flex size-full items-center justify-center px-6 text-center text-xs text-multi-fg-tertiary">
        Open a thread to inspect its tree.
      </div>
    );
  }

  return (
    <ThreadTreePanel
      thread={thread}
      open
      variant="panel"
      selectedEntryId={selectedEntryId}
      shortcutLabel={null}
      onSelect={setSelectedEntryId}
      onActivate={onActivate}
      onRegenerate={() => undefined}
      onEdit={() => undefined}
      actionsDisabled={false}
      disableRegenerate
      disableEdit
    />
  );
}
