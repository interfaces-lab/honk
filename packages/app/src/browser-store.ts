import { openCodeSessionKey, type OpenCodeSessionRef } from "@honk/opencode";
import type { DesktopBrowserViewState } from "@honk/shared/desktop-api";

import { readDesktopBrowserAvailability } from "./desktop-bridge";

type BrowserSnapshot = {
  readonly committedUrl: string;
  readonly inputValue: string;
  readonly isLoading: boolean;
  readonly loadError: string | null;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly canPictureInPicture: boolean;
};

type BrowserNavigationRequest = {
  readonly id: number;
  readonly url: string;
};

type BrowserResource = {
  readonly getSnapshot: () => BrowserSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly patch: (update: Partial<BrowserSnapshot>) => void;
  readonly getNavigationRequest: () => BrowserNavigationRequest | null;
  readonly subscribeNavigation: (listener: () => void) => () => void;
  readonly requestNavigation: (url: string) => void;
  readonly acknowledgeNavigation: (id: number) => void;
};

const INITIAL_BROWSER_SNAPSHOT: BrowserSnapshot = Object.freeze({
  committedUrl: "",
  inputValue: "",
  isLoading: false,
  loadError: null,
  canGoBack: false,
  canGoForward: false,
  canPictureInPicture: false,
});

type BrowserResourceEntry = {
  readonly owner: OpenCodeSessionRef;
  readonly resourceID: string;
  readonly resource: BrowserResource;
};

type PendingBrowserDestroy = {
  readonly entry: BrowserResourceEntry;
  readonly request: Promise<void> | null;
};

const BROWSER_AUTOMATION_RESOURCE_ID = "default";
const resources = new Map<string, BrowserResourceEntry>();
const pendingDestroys = new Map<string, PendingBrowserDestroy>();
let browserViewEventsUnsubscribe: (() => void) | null = null;

function browserResourceID(
  ref: OpenCodeSessionRef,
  resourceID = BROWSER_AUTOMATION_RESOURCE_ID,
): string {
  return JSON.stringify([openCodeSessionKey(ref), resourceID]);
}

function createBrowserResource(): BrowserResource {
  let snapshot = INITIAL_BROWSER_SNAPSHOT;
  let navigationRequest: BrowserNavigationRequest | null = null;
  let nextNavigationRequestID = 0;
  const listeners = new Set<() => void>();
  const navigationListeners = new Set<() => void>();
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    patch(update) {
      const next = Object.freeze({ ...snapshot, ...update });
      if (
        next.committedUrl === snapshot.committedUrl &&
        next.inputValue === snapshot.inputValue &&
        next.isLoading === snapshot.isLoading &&
        next.loadError === snapshot.loadError &&
        next.canGoBack === snapshot.canGoBack &&
        next.canGoForward === snapshot.canGoForward &&
        next.canPictureInPicture === snapshot.canPictureInPicture
      ) {
        return;
      }
      snapshot = next;
      for (const listener of listeners) listener();
    },
    getNavigationRequest: () => navigationRequest,
    subscribeNavigation(listener) {
      navigationListeners.add(listener);
      return () => navigationListeners.delete(listener);
    },
    requestNavigation(url) {
      navigationRequest = Object.freeze({ id: ++nextNavigationRequestID, url });
      snapshot = Object.freeze({
        ...snapshot,
        inputValue: url,
        isLoading: true,
        loadError: null,
        canPictureInPicture: false,
      });
      for (const listener of listeners) listener();
      for (const listener of navigationListeners) listener();
    },
    acknowledgeNavigation(id) {
      if (navigationRequest?.id === id) navigationRequest = null;
    },
  });
}

function applyBrowserViewState(state: DesktopBrowserViewState): void {
  const resource = resources.get(state.browserId)?.resource;
  if (resource === undefined) return;
  const current = resource.getSnapshot();
  const committedUrl = state.committedUrl;
  resource.patch({
    committedUrl,
    ...(committedUrl.length > 0 && committedUrl !== current.committedUrl
      ? { inputValue: committedUrl }
      : {}),
    isLoading: state.isLoading,
    loadError: state.loadError,
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    canPictureInPicture: state.canPictureInPicture,
  });
}

function installBrowserViewEvents(): void {
  if (browserViewEventsUnsubscribe !== null || typeof window === "undefined") return;
  const availability = readDesktopBrowserAvailability();
  if (availability.status !== "ready") return;
  browserViewEventsUnsubscribe = availability.bridge.onBrowserViewState(applyBrowserViewState);
}

function browserResourceFor(
  ref: OpenCodeSessionRef,
  resourceID = BROWSER_AUTOMATION_RESOURCE_ID,
): BrowserResource {
  installBrowserViewEvents();
  const key = browserResourceID(ref, resourceID);
  const existing = resources.get(key)?.resource;
  if (existing !== undefined) return existing;
  const created = createBrowserResource();
  resources.set(key, { owner: ref, resourceID, resource: created });
  return created;
}

function removeBrowserResource(ref: OpenCodeSessionRef, resourceID: string): void {
  removeBrowserResourceByID(browserResourceID(ref, resourceID));
}

function removeBrowserResourceByID(browserId: string): void {
  const entry = resources.get(browserId) ?? pendingDestroys.get(browserId)?.entry;
  if (entry === undefined) return;
  resources.delete(browserId);
  const pending = pendingDestroys.get(browserId) ?? { entry, request: null };
  pendingDestroys.set(browserId, pending);
  if (pending.request !== null || typeof window === "undefined") return;
  const availability = readDesktopBrowserAvailability();
  if (availability.status !== "ready") return;
  const request = availability.bridge.destroyBrowserView({ browserId });
  pendingDestroys.set(browserId, { entry, request });
  void request.then(
    () => {
      if (pendingDestroys.get(browserId)?.request === request) pendingDestroys.delete(browserId);
    },
    () => {
      if (pendingDestroys.get(browserId)?.request === request) {
        pendingDestroys.set(browserId, { entry, request: null });
      }
    },
  );
}

function removeBrowserSessions(
  server: OpenCodeSessionRef["server"],
  sessionIDs: readonly string[],
): void {
  const closing = new Set(sessionIDs);
  for (const [browserId, entry] of resources) {
    if (
      entry.resourceID !== BROWSER_AUTOMATION_RESOURCE_ID ||
      entry.owner.server !== server ||
      !closing.has(entry.owner.sessionID)
    ) {
      continue;
    }
    removeBrowserResourceByID(browserId);
  }
  for (const [browserId, pending] of pendingDestroys) {
    if (
      pending.entry.resourceID === BROWSER_AUTOMATION_RESOURCE_ID &&
      pending.entry.owner.server === server &&
      closing.has(pending.entry.owner.sessionID)
    ) {
      removeBrowserResourceByID(browserId);
    }
  }
}

function removeBrowserServer(server: OpenCodeSessionRef["server"]): void {
  for (const [browserId, entry] of resources) {
    if (entry.owner.server === server) removeBrowserResourceByID(browserId);
  }
  for (const [browserId, pending] of pendingDestroys) {
    if (pending.entry.owner.server === server) removeBrowserResourceByID(browserId);
  }
}

function requestBrowserOpen(ref: OpenCodeSessionRef, url?: string): void {
  const resource = browserResourceFor(ref);
  if (url !== undefined) resource.requestNavigation(url);
}

function resetBrowserStoreForTests(): void {
  browserViewEventsUnsubscribe?.();
  browserViewEventsUnsubscribe = null;
  resources.clear();
  pendingDestroys.clear();
}

export {
  BROWSER_AUTOMATION_RESOURCE_ID,
  applyBrowserViewState,
  browserResourceID,
  browserResourceFor,
  removeBrowserResource,
  removeBrowserServer,
  removeBrowserSessions,
  requestBrowserOpen,
  resetBrowserStoreForTests,
};
export type { BrowserNavigationRequest, BrowserResource, BrowserSnapshot };
