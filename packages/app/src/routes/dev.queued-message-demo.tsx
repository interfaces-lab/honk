import { createFileRoute, redirect } from "@tanstack/react-router";

import { QueuedMessageDemoPage } from "~/components/dev/queued-message-demo";

export const Route = createFileRoute("/dev/queued-message-demo")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: QueuedMessageDemoPage,
});
