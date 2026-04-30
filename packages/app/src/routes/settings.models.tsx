import { createFileRoute } from "@tanstack/react-router";

import { ModelsSettingsPanel } from "~/components/settings/settings-panels";

export const Route = createFileRoute("/settings/models")({
  component: ModelsSettingsPanel,
});
