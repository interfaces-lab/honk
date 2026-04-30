import { createFileRoute } from "@tanstack/react-router";

import { AppearanceSettingsPanel } from "~/components/settings/settings-panels";

export const Route = createFileRoute("/settings/appearance")({
  component: AppearanceSettingsPanel,
});
