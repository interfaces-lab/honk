import { createFileRoute } from "@tanstack/react-router";

import { ChatRouteLayout } from "~/routes/-chat-route";
import { parseWorkbenchPanelSearch } from "~/routes/-workbench-panel-search";

export const Route = createFileRoute("/_chat")({
  validateSearch: parseWorkbenchPanelSearch,
  component: ChatRouteLayout,
});
