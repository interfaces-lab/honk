import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";

import { RootErrorView, RootGate, RootNotFoundView } from "./boot";
import { HomePage } from "./home";
import { NewSessionPage } from "./new-session";
import { ONBOARDING_PATH, OnboardingPage } from "./onboarding";
import { SessionWorkbenchLayout } from "./session-workbench-layout";
import { ThreadPage } from "./thread/page";
import { V2_PATH, V2Page } from "./v2";

const rootRoute = createRootRoute({
  component: RootGate,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

// First run lands here directly (the desktop window opens honk://desktop/setup),
// and the command menu replays it by navigating. RootGate lets this route past
// the connection gate: onboarding must render before the backend is reachable.
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ONBOARDING_PATH,
  // `replay` marks a revisit from the command menu, which Escape may leave.
  // First run arrives without it and has no exit but finishing.
  validateSearch: (search: Record<string, unknown>) => ({
    replay: search.replay === true || search.replay === "1",
  }),
  component: OnboardingPage,
});

// Manual harness for the Honk Core RPC host in the desktop main process.
const v2Route = createRoute({
  getParentRoute: () => rootRoute,
  path: V2_PATH,
  component: V2Page,
});

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/server/$serverKey/session",
  component: SessionWorkbenchLayout,
});

const threadRoute = createRoute({
  getParentRoute: () => sessionRoute,
  path: "$sessionId",
  component: ThreadPage,
});

const workbenchRoute = createRoute({
  getParentRoute: () => threadRoute,
  path: "workbench/$workbenchTab",
});

const sideChatRoute = createRoute({
  getParentRoute: () => threadRoute,
  path: "side-chat/$sideChatId",
});

const browserRoute = createRoute({
  getParentRoute: () => threadRoute,
  path: "browser",
  beforeLoad: ({ location }) => {
    throw redirect({
      href: location.pathname.replace(/\/browser\/?$/, "/workbench/browser"),
      replace: true,
    });
  },
});

const changesRoute = createRoute({
  getParentRoute: () => threadRoute,
  path: "changes",
  beforeLoad: ({ location }) => {
    throw redirect({
      href: location.pathname.replace(/\/changes\/?$/, "/workbench/changes"),
      replace: true,
    });
  },
});

const newSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/new-session",
  validateSearch: (search: Record<string, unknown>) => ({
    draftId: typeof search.draftId === "string" ? search.draftId : "",
  }),
  component: NewSessionPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  onboardingRoute,
  v2Route,
  newSessionRoute,
  sessionRoute.addChildren([
    threadRoute.addChildren([workbenchRoute, sideChatRoute, browserRoute, changesRoute]),
  ]),
]);

const router = createRouter({
  routeTree,
  defaultStructuralSharing: true,
  defaultErrorComponent: RootErrorView,
  defaultNotFoundComponent: RootNotFoundView,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export { router };
