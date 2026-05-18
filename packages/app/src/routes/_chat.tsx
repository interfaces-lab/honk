import { createFileRoute } from "@tanstack/react-router";

import { ChatRouteLayout } from "~/app/routes/chat-route";
import { parseChatShellSearch } from "~/diff-route-search";

export const Route = createFileRoute("/_chat")({
  validateSearch: (search: Record<string, unknown>) => parseChatShellSearch(search),
  component: ChatRouteLayout,
});
