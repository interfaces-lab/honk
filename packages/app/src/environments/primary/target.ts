import type { DesktopEnvironmentBootstrap } from "@honk/shared/desktop-api";
import type { KnownEnvironment } from "~/lib/environment-scope";

export interface PrimaryEnvironmentTarget {
  readonly source: KnownEnvironment["source"];
  readonly target: KnownEnvironment["target"];
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
let cachedDesktopBootstrapBridge: Window["desktopBridge"] | null | undefined;
let cachedDesktopBootstrap: DesktopEnvironmentBootstrap | null = null;

export function readDesktopLocalEnvironmentBootstrap(): DesktopEnvironmentBootstrap | null {
  const bridge = window.desktopBridge ?? null;
  if (cachedDesktopBootstrapBridge === bridge) {
    return cachedDesktopBootstrap;
  }

  cachedDesktopBootstrapBridge = bridge;
  cachedDesktopBootstrap = bridge?.getLocalEnvironmentBootstrap() ?? null;
  return cachedDesktopBootstrap;
}

function normalizeBaseUrl(rawValue: string): string {
  return new URL(rawValue, window.location.origin).toString();
}

function swapBaseUrlProtocol(
  rawValue: string,
  nextProtocol: "http:" | "https:" | "ws:" | "wss:",
): string {
  const url = new URL(normalizeBaseUrl(rawValue));
  url.protocol = nextProtocol;
  return url.toString();
}

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
}

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(normalizeHostname(hostname));
}

function resolveHttpRequestBaseUrl(httpBaseUrl: string): string {
  const configuredDevServerUrl = import.meta.env.VITE_DEV_SERVER_URL?.trim();
  if (!configuredDevServerUrl) {
    return httpBaseUrl;
  }

  const currentUrl = new URL(window.location.href);
  const targetUrl = new URL(httpBaseUrl);
  const devServerUrl = new URL(configuredDevServerUrl, currentUrl.origin);

  const isCurrentOriginDevServer =
    (currentUrl.protocol === "http:" || currentUrl.protocol === "https:") &&
    currentUrl.origin === devServerUrl.origin;

  if (
    !isCurrentOriginDevServer ||
    currentUrl.origin === targetUrl.origin ||
    !isLoopbackHostname(currentUrl.hostname) ||
    !isLoopbackHostname(targetUrl.hostname)
  ) {
    return httpBaseUrl;
  }

  return currentUrl.origin;
}

function resolveConfiguredPrimaryTarget(): PrimaryEnvironmentTarget | null {
  const configuredHttpBaseUrl = import.meta.env.VITE_HTTP_URL?.trim() || undefined;
  const configuredWsBaseUrl = import.meta.env.VITE_WS_URL?.trim() || undefined;

  if (!configuredHttpBaseUrl && !configuredWsBaseUrl) {
    return null;
  }

  let resolvedHttpBaseUrl = configuredHttpBaseUrl;
  let resolvedWsBaseUrl = configuredWsBaseUrl;

  if (!resolvedHttpBaseUrl && resolvedWsBaseUrl) {
    resolvedHttpBaseUrl = swapBaseUrlProtocol(
      resolvedWsBaseUrl,
      resolvedWsBaseUrl.startsWith("wss:") ? "https:" : "http:",
    );
  }
  if (!resolvedWsBaseUrl && resolvedHttpBaseUrl) {
    resolvedWsBaseUrl = swapBaseUrlProtocol(
      resolvedHttpBaseUrl,
      resolvedHttpBaseUrl.startsWith("https:") ? "wss:" : "ws:",
    );
  }

  if (!resolvedHttpBaseUrl || !resolvedWsBaseUrl) {
    return null;
  }

  return {
    source: "configured",
    target: {
      httpBaseUrl: normalizeBaseUrl(resolvedHttpBaseUrl),
      wsBaseUrl: normalizeBaseUrl(resolvedWsBaseUrl),
    },
  };
}

function resolveWindowOriginPrimaryTarget(): PrimaryEnvironmentTarget {
  const httpBaseUrl = normalizeBaseUrl(window.location.origin);
  const url = new URL(httpBaseUrl);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else {
    throw new Error(`Unsupported HTTP base URL protocol: ${url.protocol}`);
  }
  return {
    source: "window-origin",
    target: {
      httpBaseUrl,
      wsBaseUrl: url.toString(),
    },
  };
}

function resolveDesktopPrimaryTarget(): PrimaryEnvironmentTarget | null {
  const desktopBootstrap = readDesktopLocalEnvironmentBootstrap();
  if (!desktopBootstrap) {
    return null;
  }

  return {
    source: "desktop-managed",
    target: {
      httpBaseUrl: normalizeBaseUrl(desktopBootstrap.httpBaseUrl),
      wsBaseUrl: desktopBootstrap.httpBaseUrl.startsWith("https:")
        ? swapBaseUrlProtocol(desktopBootstrap.httpBaseUrl, "wss:")
        : swapBaseUrlProtocol(desktopBootstrap.httpBaseUrl, "ws:"),
    },
  };
}

export function resolvePrimaryEnvironmentHttpUrl(
  pathname: string,
  searchParams?: Record<string, string>,
): string {
  const primaryTarget = readPrimaryEnvironmentTarget();
  if (!primaryTarget) {
    throw new Error("Unable to resolve the primary environment HTTP base URL.");
  }

  const requestBaseUrl =
    primaryTarget.source === "window-origin"
      ? resolveHttpRequestBaseUrl(primaryTarget.target.httpBaseUrl)
      : primaryTarget.target.httpBaseUrl;
  const url = new URL(requestBaseUrl);
  url.pathname = pathname;
  if (searchParams) {
    url.search = new URLSearchParams(searchParams).toString();
  }
  return url.toString();
}

export function readPrimaryEnvironmentTarget(): PrimaryEnvironmentTarget | null {
  return (
    resolveDesktopPrimaryTarget() ??
    resolveConfiguredPrimaryTarget() ??
    resolveWindowOriginPrimaryTarget()
  );
}
