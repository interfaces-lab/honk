// Renders the /setup route the way the desktop window opens it on first run.
//
// The harness registers the route without `validateSearch`: this TanStack
// version resolves zero matches for a memory-history route that declares one,
// and the real router's search contract only decides whether Escape may leave.

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { SETUP_PATH, SetupPage } from "./setup";

async function renderSetup(): Promise<string> {
  const rootRoute = createRootRoute({ component: Outlet });
  const setupRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: SETUP_PATH,
    component: SetupPage,
  });
  const router = createRouter({
    defaultStructuralSharing: true,
    history: createMemoryHistory({ initialEntries: [SETUP_PATH] }),
    routeTree: rootRoute.addChildren([setupRoute]),
  });

  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

it("opens on the defaults-or-configure choice", async () => {
  const html = await renderSetup();

  expect(html).toContain("Meet Honk");
  expect(html).toContain("Use defaults");
  expect(html).toContain("Configure");
});

it("states what Use defaults will change before the button that changes it", async () => {
  const html = await renderSetup();

  expect(html).toContain("your home folder the default project folder");
  expect(html.indexOf("your home folder the default project folder")).toBeGreaterThan(
    html.indexOf("Use defaults"),
  );
});

it("shows no progress bar", async () => {
  const html = await renderSetup();

  expect(html).not.toContain('role="progressbar"');
});

it("starts on the opening choice rather than a configure step", async () => {
  const html = await renderSetup();

  expect(html).not.toContain("Where your work starts");
  expect(html).not.toContain("Coding accounts");
  expect(html).not.toContain("Ready to work?");
});
