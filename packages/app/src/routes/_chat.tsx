import { createFileRoute, redirect } from "@tanstack/react-router";

import { ChatRouteLayout } from "~/app/routes/chat-route";

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ChatRouteLayout,
});
