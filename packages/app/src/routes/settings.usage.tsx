import { createFileRoute } from "@tanstack/react-router";

import { UsageSettingsPanel } from "~/components/settings/usage-settings-panel";

export const Route = createFileRoute("/settings/usage")({
  component: UsageSettingsPanel,
});
