import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Outlet, type ErrorComponentProps, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { CommandPalette } from "~/components/command-palette";
import { TaskCompletionNotifications } from "~/notifications/taskCompletion";
import { AnchoredToastProvider, ToastProvider } from "~/app/toast";
import { syncBrowserChromeTheme } from "~/hooks/use-theme";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { DevDevtoolsPanel } from "~/dev/devtools-panel";
import { useSettings } from "~/hooks/use-settings";
import { APPEARANCE_SETTINGS_CHANGED } from "~/lib/appearance-settings";
import { startCoreEnvironmentConnectionService } from "~/environments/core";
import { readDesktopLocalEnvironmentBootstrap } from "~/environments/primary/target";
import { RootStatusPage } from "./-root-status-page";

const routeApi = getRouteApi("__root__");

export function RootRouteView() {
  const { authGateState, devStandalone } = routeApi.useRouteContext();

  if (devStandalone) {
    return (
      <ToastProvider>
        <RootMountPerformanceMark />
        <BrowserChromeThemeSync key="dev-standalone" />
        <AnchoredToastProvider>
          <Outlet />
          <DevDevtoolsPanel />
        </AnchoredToastProvider>
      </ToastProvider>
    );
  }

  if (authGateState.status !== "authenticated") {
    return (
      <>
        <RootMountPerformanceMark />
        <BrowserChromeThemeSync key={authGateState.status} />
        <AuthenticationRequiredView
          message={
            authGateState.errorMessage ??
            "The local environment did not accept the desktop bootstrap credential."
          }
          browserBootstrapUrl={readDesktopBrowserBootstrapUrl()}
        />
        <DevDevtoolsPanel />
      </>
    );
  }
  return (
    <ToastProvider>
      <RootMountPerformanceMark />
      <BrowserChromeThemeSync key={authGateState.status} />
      <AnchoredToastProvider>
        <CursorPreferenceSync />
        <EnvironmentConnectionServiceSync />
        <TaskCompletionNotifications />
        <CommandPalette>
          <Outlet />
        </CommandPalette>
        <DevDevtoolsPanel />
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

function RootMountPerformanceMark() {
  useMountEffect(() => {
    window.performance.mark("honk:root-mounted");
  });

  return null;
}

function BrowserChromeThemeSync() {
  useMountEffect(() => {
    const sync = () => {
      syncBrowserChromeTheme();
    };
    const frame = window.requestAnimationFrame(sync);
    window.addEventListener(APPEARANCE_SETTINGS_CHANGED, sync);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener(APPEARANCE_SETTINGS_CHANGED, sync);
    };
  });

  return null;
}

function EnvironmentConnectionServiceSync() {
  const queryClient = useQueryClient();

  useMountEffect(() => startCoreEnvironmentConnectionService(queryClient));

  return null;
}

function CursorPreferenceSync() {
  const cursorPointerOnButtons = useSettings((settings) => settings.cursorPointerOnButtons);

  return (
    <CursorPreferenceDomSync
      key={cursorPointerOnButtons ? "pointer-cursor" : "default-cursor"}
      cursorPointerOnButtons={cursorPointerOnButtons}
    />
  );
}

function CursorPreferenceDomSync(props: { readonly cursorPointerOnButtons: boolean }) {
  useMountEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--honk-button-cursor",
      props.cursorPointerOnButtons ? "pointer" : "default",
    );
    root.toggleAttribute("data-no-button-pointer", !props.cursorPointerOnButtons);
  });

  return null;
}

export function RootRouteErrorView({ error }: ErrorComponentProps) {
  const details = errorDetails(error);
  const [copied, setCopied] = useState(false);

  return (
    <RootStatusPage
      title="Something went wrong"
      description="An unexpected error occurred. Reload the window to try again."
      details={details}
      actions={[
        {
          label: "Reload Window",
          onClick: () => window.location.reload(),
        },
        {
          label: copied ? "Copied" : "Copy Error",
          onClick: () => {
            void copyText(details).then(() => setCopied(true));
          },
        },
      ]}
    />
  );
}

export function RootRouteNotFoundView() {
  const navigate = useNavigate();

  return (
    <RootStatusPage
      title="Page not found"
      description="The requested page could not be found."
      actions={[
        {
          label: "Go Home",
          onClick: () => {
            void navigate({ to: "/", replace: true });
          },
        },
        {
          label: "Reload Window",
          onClick: () => window.location.reload(),
        },
      ]}
    />
  );
}

function AuthenticationRequiredView({
  browserBootstrapUrl,
  message,
}: {
  readonly browserBootstrapUrl: string | null;
  readonly message: string;
}) {
  return (
    <RootStatusPage
      title="Local authentication failed"
      description={message}
      actions={[
        {
          label: "Reload Window",
          onClick: () => window.location.reload(),
        },
        ...(browserBootstrapUrl
          ? [
              {
                label: "Open in Browser",
                onClick: () => openBrowserBootstrapUrl(browserBootstrapUrl),
              },
            ]
          : []),
      ]}
    />
  );
}

function readDesktopBrowserBootstrapUrl(): string | null {
  return readDesktopLocalEnvironmentBootstrap()?.browserBootstrapUrl ?? null;
}

function openBrowserBootstrapUrl(url: string): void {
  const opened = window.desktopBridge?.openExternal(url);
  if (opened) {
    void opened;
    return;
  }

  window.open(url, "_blank", "noopener");
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    const details = error.stack ?? error.message;
    return details.trim().length > 0 ? details : "No additional error details are available.";
  }

  if (typeof error === "string") {
    return error.trim().length > 0 ? error : "No additional error details are available.";
  }

  try {
    const details = JSON.stringify(error, null, 2);
    if (typeof details === "string" && details.trim().length > 0) {
      return details;
    }
    return "No additional error details are available.";
  } catch {
    return "No additional error details are available.";
  }
}

async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    return;
  }
  await navigator.clipboard.writeText(value);
}
