import { TanStackDevtools } from "@tanstack/react-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { ThreadTreeDevtoolsPanel } from "./thread-tree-devtools";

export function RouterDevtoolsPanel() {
  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <TanStackDevtools
      plugins={[
        {
          id: "react-query",
          name: "React Query",
          defaultOpen: true,
          render: <ReactQueryDevtoolsPanel style={{ height: "100%" }} />,
        },
        {
          id: "react-router",
          name: "React Router",
          render: <TanStackRouterDevtoolsPanel style={{ height: "100%" }} />,
        },
        {
          id: "thread-tree",
          name: "Thread Tree",
          render: <ThreadTreeDevtoolsPanel />,
        },
      ]}
    />
  );
}
