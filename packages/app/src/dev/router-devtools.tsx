import { TanStackDevtools } from "@tanstack/react-devtools";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Suspense } from "react";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThreadTreeDevtoolsPanel } from "./thread-tree-devtools";

export function RouterDevtoolsPanel() {
  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <TanStackDevtools
        plugins={[
          { name: "Thread Tree", render: <ThreadTreeDevtoolsPanel /> },
          { name: "React Router", render: <TanStackRouterDevtools /> },
          { name: "React Query", render: <ReactQueryDevtools /> },
        ]}
      />
    </Suspense>
  );
}
