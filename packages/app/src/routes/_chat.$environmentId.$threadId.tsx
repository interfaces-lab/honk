import { createFileRoute } from "@tanstack/react-router";

import { ChatThreadRouteView } from "~/app/routes/chat-thread-route";

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  component: ChatThreadRouteView,
});
