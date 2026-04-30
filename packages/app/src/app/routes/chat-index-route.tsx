import { useEffect } from "react";

import { NoActiveThreadState } from "~/components/no-active-thread-state";
import { useHandleNewThread } from "~/hooks/use-handle-new-thread";
import { useSettings } from "~/hooks/use-settings";
import { resolveSidebarNewThreadEnvMode } from "~/lib/thread-sidebar";

export function ChatIndexRouteView() {
  const { defaultProjectRef, handleNewThread } = useHandleNewThread();
  const defaultThreadEnvMode = useSettings((settings) => settings.defaultThreadEnvMode);

  useEffect(() => {
    if (!defaultProjectRef) {
      return;
    }
    void handleNewThread(defaultProjectRef, {
      envMode: resolveSidebarNewThreadEnvMode({
        defaultEnvMode: defaultThreadEnvMode,
      }),
    });
  }, [defaultProjectRef, defaultThreadEnvMode, handleNewThread]);

  return <NoActiveThreadState />;
}
