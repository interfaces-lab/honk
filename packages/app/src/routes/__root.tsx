import { type QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";

import { APP_DISPLAY_NAME } from "~/app/branding";
import { RootRouteErrorView, RootRouteNotFoundView, RootRouteView } from "~/routes/-root-route";
import {
  ensurePrimaryEnvironmentReady,
  resolveInitialServerAuthGateState,
} from "~/environments/primary";

function isStandaloneDevRoute(pathname: string): boolean {
  return import.meta.env.DEV && pathname === "/dev/honkkit";
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  beforeLoad: async ({ location }) => {
    if (isStandaloneDevRoute(location.pathname)) {
      return {
        authGateState: { status: "authenticated" } as const,
        devStandalone: true,
      };
    }

    const [, authGateState] = await Promise.all([
      ensurePrimaryEnvironmentReady(),
      resolveInitialServerAuthGateState(),
    ]);
    return {
      authGateState,
      devStandalone: false,
    };
  },
  component: RootRouteView,
  errorComponent: RootRouteErrorView,
  notFoundComponent: RootRouteNotFoundView,
  head: () => ({
    meta: [{ name: "title", content: APP_DISPLAY_NAME }],
    scripts: import.meta.env.DEV ? [{ src: "https://ui.sh/ui-picker.js" }] : [],
  }),
});
