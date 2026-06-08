import { createFileRoute } from "@tanstack/react-router";

import {
  ChatIndexRouteView,
  prepareChatIndexRouteDraft,
} from "~/routes/-chat-index-route";

export const Route = createFileRoute("/_chat/")({
  beforeLoad: () => {
    prepareChatIndexRouteDraft();
  },
  component: ChatIndexRouteView,
});
