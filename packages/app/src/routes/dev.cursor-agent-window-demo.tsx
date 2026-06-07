import { createFileRoute, redirect } from "@tanstack/react-router";

import { CursorAgentWindowDemoPage } from "~/components/dev/cursor-agent-window-demo";

export const Route = createFileRoute("/dev/cursor-agent-window-demo")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: CursorAgentWindowDemoPage,
});
