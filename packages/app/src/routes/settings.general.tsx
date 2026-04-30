import { createFileRoute } from "@tanstack/react-router";

import { GeneralSettingsPanel } from "~/components/settings/settings-panels";

export const Route = createFileRoute("/settings/general")({
  component: GeneralSettingsPanel,
});
