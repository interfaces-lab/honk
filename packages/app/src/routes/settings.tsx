import { createFileRoute, redirect } from "@tanstack/react-router";

import { SettingsRouteLayout } from "~/app/routes/settings-route";
import { DEFAULT_SETTINGS_ROUTE } from "~/components/settings/settings-sections";

export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/settings") {
      throw redirect({ to: DEFAULT_SETTINGS_ROUTE, replace: true });
    }
  },
  component: SettingsRouteLayout,
});
