import { createFileRoute } from "@tanstack/react-router";

import { DraftChatThreadRouteView } from "~/app/routes/chat-draft-route";
import { DraftId } from "~/stores/chat-drafts";

export const Route = createFileRoute("/_chat/draft/$draftId")({
  params: {
    parse: ({ draftId }) => ({
      draftId: DraftId.make(draftId),
    }),
    stringify: ({ draftId }) => ({
      draftId,
    }),
  },
  component: DraftChatThreadRouteView,
});
