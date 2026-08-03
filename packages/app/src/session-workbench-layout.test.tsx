import { createOpenCodeServer, openCodeSessionRef } from "@honk/opencode";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { openCodeSessionHref } from "./opencode/tab-route";
import { SessionWorkbenchLayout } from "./session-workbench-layout";

const watchedSessionIDs = vi.hoisted(() => [] as string[]);

vi.mock("./use-sdk-watch", () => ({
  useSessionWatch: (ref: { readonly sessionID: string }) => {
    watchedSessionIDs.push(ref.sessionID);
    return { state: null };
  },
}));

it("tracks the child route match when navigating between sessions on one server", async () => {
  const server = createOpenCodeServer({ origin: "http://127.0.0.1:13975", kind: "local" });
  const first = openCodeSessionRef(server.key, "ses_first");
  const second = openCodeSessionRef(server.key, "ses_second");
  const rootRoute = createRootRoute({ component: Outlet });
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/server/$serverKey/session",
    component: SessionWorkbenchLayout,
  });
  const threadRoute = createRoute({
    getParentRoute: () => sessionRoute,
    path: "$sessionId",
    component: () => null,
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [openCodeSessionHref(first)] }),
    routeTree: rootRoute.addChildren([sessionRoute.addChildren([threadRoute])]),
  });

  await router.load();
  renderToStaticMarkup(<RouterProvider router={router} />);
  const navigation = router.navigate({ href: openCodeSessionHref(second) });
  renderToStaticMarkup(<RouterProvider router={router} />);
  await navigation;
  renderToStaticMarkup(<RouterProvider router={router} />);

  expect(watchedSessionIDs).toEqual([first.sessionID, first.sessionID, second.sessionID]);
});
