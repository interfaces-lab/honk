import { createFileRoute } from "@tanstack/react-router";

import { ChatRouteLayout } from "~/app/routes/chat-route";
import { parseWorkbenchPanelSearch } from "~/app/routes/workbench-panel-search";

export const Route = createFileRoute("/_chat")({
  validateSearch: parseWorkbenchPanelSearch,
  component: ChatRouteLayout,
});
