import { createFileRoute, retainSearchParams } from "@tanstack/react-router";

import { ChatThreadRouteView } from "~/app/routes/chat-thread-route";
import { type DiffRouteSearch, parseDiffRouteSearch } from "~/diff-route-search";

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff"])],
  },
  component: ChatThreadRouteView,
});
