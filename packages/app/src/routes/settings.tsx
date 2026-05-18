import { createFileRoute, redirect } from "@tanstack/react-router";

import { SettingsRouteLayout } from "~/app/routes/settings-route";

export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/settings") {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsRouteLayout,
});
