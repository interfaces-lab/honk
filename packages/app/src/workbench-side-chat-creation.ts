import type { OpenCodeSessionRef } from "@honk/opencode";
import { openCodeSessionRef } from "@honk/opencode";
import * as React from "react";

import { errorMessage } from "./error-message";
import { actions as toastActions } from "./toast-store";
import { getOpenCodeClient } from "./watch-registry";
import { isCurrentWorkbenchSession } from "./workbench-controller";
import {
  workbenchTabActions,
  type WorkbenchSideChatTab,
} from "./workbench-tab-store";

function useWorkbenchSideChatCreation(input: {
  readonly isRouteReady: boolean;
  readonly parentRef: OpenCodeSessionRef;
  readonly workspaceKey: string;
  readonly onOpen: (tab: WorkbenchSideChatTab) => void;
}): {
  readonly createSideChat: () => Promise<void>;
  readonly isCreatingSideChat: boolean;
} {
  const [isCreatingSideChat, setCreatingSideChat] = React.useState(false);

  const createSideChat = async (): Promise<void> => {
    if (!input.isRouteReady || isCreatingSideChat) return;
    const client = getOpenCodeClient(input.parentRef.server);
    if (client === null) {
      toastActions.add({
        type: "error",
        title: "Side Chat unavailable",
        description: "The OpenCode connection is not ready yet.",
      });
      return;
    }

    setCreatingSideChat(true);
    try {
      const parent = await client.sessions.get(input.parentRef);
      const child = await client.sessions.create({
        parentID: parent.id,
        title: "New Side Chat",
        ...(parent.agent === undefined ? {} : { agent: parent.agent }),
        ...(parent.model === undefined ? {} : { model: parent.model }),
        location: parent.location,
      });
      const childRef = openCodeSessionRef(input.parentRef.server, child.id);
      if (!isCurrentWorkbenchSession(input.parentRef)) {
        workbenchTabActions.rememberSideChat(
          input.workspaceKey,
          input.parentRef,
          childRef,
          child.title,
        );
      } else {
        input.onOpen(
          workbenchTabActions.openSideChat(
            input.workspaceKey,
            input.parentRef,
            childRef,
            child.title,
          ),
        );
      }
    } catch (error) {
      toastActions.add({
        type: "error",
        title: "Couldn't create Side Chat",
        description: errorMessage(error),
      });
    }
    setCreatingSideChat(false);
  };

  return { createSideChat, isCreatingSideChat };
}

export { useWorkbenchSideChatCreation };
