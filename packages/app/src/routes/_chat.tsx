import { createFileRoute } from "@tanstack/react-router";

import { ChatRouteLayout } from "~/app/routes/chat-route";

export const Route = createFileRoute("/_chat")({
  component: ChatRouteLayout,
});
