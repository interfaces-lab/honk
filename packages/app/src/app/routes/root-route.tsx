import { getRouteApi, Outlet, type ErrorComponentProps, useNavigate } from "@tanstack/react-router";

import { APP_DISPLAY_NAME } from "~/app/branding";
import { CommandPalette } from "~/components/command-palette";
import { TaskCompletionNotifications } from "~/notifications/taskCompletion";
import { Button } from "@multi/ui/button";
import { AnchoredToastProvider, ToastProvider } from "~/app/toast";
import { syncBrowserChromeTheme } from "~/hooks/use-theme";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { DevDevtoolsPanel } from "~/dev/devtools-panel";
import { useSettings } from "~/hooks/use-settings";
import { APPEARANCE_SETTINGS_CHANGED } from "~/lib/appearance-settings";
import { startDesktopRuntimeHostSync } from "~/stores/agent-runtime-store";
import { debugLog } from "~/lib/debug-log";

const routeApi = getRouteApi("__root__");

export function RootRouteView() {
  const { authGateState, devStandalone } = routeApi.useRouteContext();
  debugLog("root.render", {
    authStatus: authGateState.status,
    devStandalone,
  });

  if (devStandalone) {
    return (
      <ToastProvider>
        <RootMountPerformanceMark />
        <BrowserChromeThemeSync key="dev-standalone" />
        <AnchoredToastProvider>
          <CommandPalette>
            <Outlet />
          </CommandPalette>
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
        <DesktopRuntimeHostBootstrap />
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
    window.performance.mark("multi:root-mounted");
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
      "--multi-button-cursor",
      props.cursorPointerOnButtons ? "pointer" : "default",
    );
    root.toggleAttribute("data-no-button-pointer", !props.cursorPointerOnButtons);
  });

  return null;
}

export function RootRouteErrorView({ error, reset }: ErrorComponentProps) {
  const message = errorMessage(error);
  const details = errorDetails(error);
  debugLog("root.error", {
    message,
    details,
  });

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--color-red-500)_16%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_90%,var(--color-black))_0%,var(--background)_55%)]" />
      </div>

      <section className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-detail font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          Something went wrong.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => reset()}>
            Try again
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            Reload app
          </Button>
        </div>

        <details className="group mt-5 overflow-hidden rounded-lg border border-border/70 bg-background/55">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground">
            <span className="group-open:hidden">Show error details</span>
            <span className="hidden group-open:inline">Hide error details</span>
          </summary>
          <pre className="max-h-56 overflow-auto border-t border-border/70 bg-background/80 px-3 py-2 text-xs text-foreground/85">
            {details}
          </pre>
        </details>
      </section>
    </div>
  );
}

export function RootRouteNotFoundView() {
  const navigate = useNavigate();

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-detail font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Route not found.</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The current app route does not exist in this build.
        </p>
        <div className="mt-5">
          <Button size="sm" onClick={() => void navigate({ to: "/", replace: true })}>
            Go home
          </Button>
        </div>
      </section>
    </div>
  );
}

function AuthenticationRequiredView({ message }: { readonly message: string }) {
  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-detail font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          Local authentication failed.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>
        <div className="mt-5">
          <Button size="sm" onClick={() => window.location.reload()}>
            Reload app
          </Button>
        </div>
      </section>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "An unexpected router error occurred.";
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return "No additional error details are available.";
  }
}

function DesktopRuntimeHostBootstrap() {
  useMountEffect(() => startDesktopRuntimeHostSync());

  return null;
}
