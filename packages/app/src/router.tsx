import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";

import { RootErrorView, RootGate, RootNotFoundView } from "./boot";
import { HomePage } from "./home";
import { NewSessionPage } from "./new-session";
import { SessionWorkbenchLayout } from "./session-workbench-layout";
import { ThreadPage } from "./thread/page";

const rootRoute = createRootRoute({
  component: RootGate,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
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
