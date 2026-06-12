import { createFileRoute } from "@tanstack/react-router";
import { EnvironmentId, ThreadId } from "@honk/contracts";

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
