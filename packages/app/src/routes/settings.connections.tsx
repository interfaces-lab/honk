import { createFileRoute } from "@tanstack/react-router";

import { ConnectionsSettings } from "~/components/settings/connections-settings";

export const Route = createFileRoute("/settings/connections")({
  component: ConnectionsSettings,
});
