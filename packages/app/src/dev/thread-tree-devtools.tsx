import { ThreadId } from "@honk/contracts";
import { useMemo } from "react";
import { useRouteThreadId } from "~/hooks/use-route-thread-id";
import { useStore } from "~/stores/thread-store";
import { createThreadSelectorAcrossEnvironments } from "~/stores/thread-selectors";
import { ThreadTreePanel } from "~/components/chat/view/thread-tree-panel";

export function ThreadTreeDevtoolsPanel() {
  const routeThreadId = useRouteThreadId();
  const activeThreadId = routeThreadId ? ThreadId.make(routeThreadId) : null;
  const threadSelector = useMemo(
    () => createThreadSelectorAcrossEnvironments(activeThreadId),
    [activeThreadId],
  );
  const thread = useStore(threadSelector);

  if (!thread) {
    return (
      <div className="flex size-full items-center justify-center px-6 text-center text-xs text-honk-fg-tertiary">
        Open a thread to inspect its tree.
      </div>
    );
  }

  return <ThreadTreePanel thread={thread} variant="panel" />;
}
