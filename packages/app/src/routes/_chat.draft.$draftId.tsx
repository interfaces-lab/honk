import { createFileRoute } from "@tanstack/react-router";

import {
  createDraftRouteSession,
  DraftChatThreadRouteView,
} from "~/routes/-chat-draft-route";
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
  beforeLoad: ({ params }) => {
    createDraftRouteSession(params.draftId);
  },
  component: DraftChatThreadRouteView,
});
