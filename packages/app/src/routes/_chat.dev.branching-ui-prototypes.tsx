import { createFileRoute, redirect } from "@tanstack/react-router";

import { BranchingUiPrototypesPage } from "~/components/dev/branching-ui-prototypes";

export const Route = createFileRoute("/_chat/dev/branching-ui-prototypes")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: BranchingUiPrototypesPage,
});
