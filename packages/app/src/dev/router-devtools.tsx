import { TanStackDevtools } from "@tanstack/react-devtools";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Suspense } from "react";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

export function RouterDevtoolsPanel() {
  return (
    <Suspense fallback={null}>
      <TanStackDevtools
        plugins={[
          { name: "React Router", render: <TanStackRouterDevtools /> },
          { name: "React Query", render: <ReactQueryDevtools /> },
        ]}
      />
    </Suspense>
  );
}
