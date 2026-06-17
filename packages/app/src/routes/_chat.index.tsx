import { createFileRoute, redirect } from "@tanstack/react-router";

import { ChatIndexRouteView, prepareChatIndexRouteDraft } from "~/routes/-chat-index-route";
import { draftRouteParams } from "~/app/chat-route-state";

export const Route = createFileRoute("/_chat/")({
  beforeLoad: () => {
    const draftId = prepareChatIndexRouteDraft();
    if (draftId !== null) {
      throw redirect({
        to: "/draft/$draftId",
        params: draftRouteParams(draftId),
        replace: true,
      });
    }
  },
  component: ChatIndexRouteView,
});
