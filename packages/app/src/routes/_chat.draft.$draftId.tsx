import { createFileRoute } from "@tanstack/react-router";

import { DraftChatThreadRouteView } from "~/app/routes/chat-draft-route";

export const Route = createFileRoute("/_chat/draft/$draftId")({
  component: DraftChatThreadRouteView,
});
