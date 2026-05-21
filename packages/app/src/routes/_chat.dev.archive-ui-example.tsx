import { createFileRoute, redirect } from "@tanstack/react-router";

import { ArchiveUiExamplePage } from "~/components/dev/archive-ui-example";

export const Route = createFileRoute("/_chat/dev/archive-ui-example")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: ArchiveUiExamplePage,
});
