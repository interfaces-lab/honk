import { createFileRoute, redirect } from "@tanstack/react-router";

import { PairRoutePendingView, PairRouteView } from "~/app/routes/pair-route";

export const Route = createFileRoute("/pair")({
  beforeLoad: async ({ context }) => {
    const { authGateState } = context;
    if (authGateState.status === "authenticated") {
      throw redirect({ to: "/", replace: true });
    }
    return {
      authGateState,
    };
  },
  component: PairRouteView,
  pendingComponent: PairRoutePendingView,
});
