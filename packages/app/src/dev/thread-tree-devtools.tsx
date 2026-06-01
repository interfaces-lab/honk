import { ThreadId } from "@multi/contracts";
import { useMemo } from "react";

import { useRouteThreadId } from "~/hooks/use-route-thread-id";
import { useStore } from "~/stores/thread-store";
import { createThreadSelectorAcrossEnvironments } from "~/stores/thread-selectors";
import { ThreadTreePanel } from "~/components/chat/view/thread-tree-panel";

export function ThreadTreeDevtoolsPanel() {
  const routeThreadId = useRouteThreadId();
  const activeThreadId = routeThreadId ? ThreadId.make(routeThreadId) : null;
  const thread = useStore(
    useMemo(() => createThreadSelectorAcrossEnvironments(activeThreadId), [activeThreadId]),
  );

  if (!thread) {
    return (
      <div className="flex size-full items-center justify-center px-6 text-center text-xs text-multi-fg-tertiary">
        Open a thread to inspect its tree.
      </div>
    );
  }

  return <ThreadTreePanel thread={thread} variant="panel" />;
}
