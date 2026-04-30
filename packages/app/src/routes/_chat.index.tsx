import { createFileRoute } from "@tanstack/react-router";

import { ChatIndexRouteView } from "~/app/routes/chat-index-route";

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
