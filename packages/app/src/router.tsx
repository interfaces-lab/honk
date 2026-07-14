// Route tree — code-based TanStack Router (same idiom as packages/ui/dev). One file for the
// tree; page components live beside their concept. File-based routing stays with the frozen
// legacy app; the rewrite keeps the tree small and explicit (ADR 0011).
//
// Root is RootGate (boot.tsx): connection-store decides between gate surfaces and AppShell.

import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { RootErrorView, RootGate, RootNotFoundView } from "./boot";
import { HomePage } from "./home";
import { DEFAULT_SETTINGS_SECTION, SettingsPage, type SettingsSectionId } from "./settings";
import { ThreadPage } from "./thread";

const rootRoute = createRootRoute({
  component: RootGate,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

// The NATIVE thread view over the opencode sidecar — the legacy iframe host died in the
// atomic round's clean break (2026-07-11 grill).
const threadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/thread/$threadId",
  component: ThreadPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
  validateSearch: (search: Record<string, unknown>): { section: SettingsSectionId } => {
    const section = search["section"];
    if (
      section === "general" ||
      section === "providers" ||
      section === "appearance" ||
      section === "archived"
    ) {
      return { section };
    }
    return { section: DEFAULT_SETTINGS_SECTION };
  },
});

const routeTree = rootRoute.addChildren([indexRoute, threadRoute, settingsRoute]);

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
