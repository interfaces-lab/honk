import { createFileRoute } from "@tanstack/react-router";
import { EnvironmentId } from "@honk/shared/environment";
import { ThreadId } from "@honk/shared/base-schemas";

import { ChatThreadRouteView } from "~/routes/-chat-thread-route";

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  params: {
    parse: ({ environmentId, threadId }) => ({
      environmentId: EnvironmentId.make(environmentId),
      threadId: ThreadId.make(threadId),
    }),
    stringify: ({ environmentId, threadId }) => ({
      environmentId,
      threadId,
    }),
  },
  component: ChatThreadRouteView,
});
