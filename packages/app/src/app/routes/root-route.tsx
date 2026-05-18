import { type ServerLifecycleWelcomePayload } from "@multi/contracts";
import { scopedProjectKey, scopeProjectRef } from "@multi/client-runtime";
import { getRouteApi, Outlet, type ErrorComponentProps, useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { APP_DISPLAY_NAME } from "~/branding";
import { CommandPalette } from "~/components/command-palette";
import { TaskCompletionNotifications } from "~/notifications/taskCompletion";
import {
  SlowRpcAckToastCoordinator,
  WebSocketConnectionCoordinator,
  WebSocketConnectionSurface,
} from "~/components/web-socket-connection-surface";
import { Button } from "@multi/ui/button";
import { AnchoredToastProvider, ToastProvider, toastManager } from "~/app/toast";
import { resolveAndPersistPreferredEditor } from "~/editor-preferences";
import { readLocalApi } from "~/local-api";
import {
  getServerConfigUpdatedNotification,
  ServerConfigUpdatedNotification,
  startServerStateSync,
  useServerConfig,
  useServerEnvironment,
  useServerConfigUpdatedSubscription,
  useServerWelcomeSubscription,
} from "~/rpc/server-state";
import { selectEnvironmentState, selectProjectByRef, useStore } from "~/stores/thread-store";
import { useUiStateStore } from "~/stores/ui-state-store";
import { syncBrowserChromeTheme } from "~/hooks/use-theme";
import {
  ensureEnvironmentConnectionBootstrapped,
  getPrimaryEnvironmentConnection,
  startEnvironmentConnectionService,
} from "~/environments/runtime";
import { updatePrimaryEnvironmentDescriptor } from "~/environments/primary";
import { RouterDevtoolsPanel } from "~/dev/router-devtools";
import { deriveLogicalProjectKey, derivePhysicalProjectKeyFromPath } from "~/logical-project";
import { useSettings } from "~/hooks/use-settings";

const routeApi = getRouteApi("__root__");

export function RootRouteView() {
  const { authGateState } = routeApi.useRouteContext();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      syncBrowserChromeTheme();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [authGateState.status]);

  if (authGateState.status !== "authenticated") {
    return (
      <>
        <AuthenticationRequiredView
          message={
            authGateState.errorMessage ??
            "The local environment did not accept the desktop bootstrap credential."
          }
        />
        <RouterDevtoolsPanel />
      </>
    );
  }
  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <CursorPreferenceSync />
        <ServerStateBootstrap />
        <EnvironmentConnectionManagerBootstrap />
        <EventRouter />
        <WebSocketConnectionCoordinator />
        <SlowRpcAckToastCoordinator />
        <TaskCompletionNotifications />
        <WebSocketConnectionSurface>
          <CommandPalette>
            <Outlet />
          </CommandPalette>
        </WebSocketConnectionSurface>
        <RouterDevtoolsPanel />
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

function CursorPreferenceSync() {
  const cursorPointerOnButtons = useSettings((settings) => settings.cursorPointerOnButtons);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--multi-button-cursor", cursorPointerOnButtons ? "pointer" : "auto");
    root.toggleAttribute("data-no-button-pointer", !cursorPointerOnButtons);
  }, [cursorPointerOnButtons]);

  return null;
}

export function RootRouteErrorView({ error, reset }: ErrorComponentProps) {
  const message = errorMessage(error);
  const details = errorDetails(error);

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

function ServerStateBootstrap() {
  useEffect(() => {
    return startServerStateSync(getPrimaryEnvironmentConnection().client.server);
  }, []);

  return null;
}

function EnvironmentConnectionManagerBootstrap() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return startEnvironmentConnectionService(queryClient);
  }, [queryClient]);

  return null;
}

function EventRouter() {
  const setActiveEnvironmentId = useStore((store) => store.setActiveEnvironmentId);
  const seenServerConfigUpdateIdRef = useRef(getServerConfigUpdatedNotification()?.id ?? 0);
  const disposedRef = useRef(false);
  const serverEnvironment = useServerEnvironment();
  const serverConfig = useServerConfig();

  const handleWelcome = useEffectEvent((payload: ServerLifecycleWelcomePayload | null) => {
    if (!payload) return;

    updatePrimaryEnvironmentDescriptor(payload.environment);
    setActiveEnvironmentId(payload.environment.environmentId);
    void (async () => {
      await ensureEnvironmentConnectionBootstrapped(payload.environment.environmentId);
      if (disposedRef.current) {
        return;
      }

      if (!payload.bootstrapProjectId || !payload.bootstrapThreadId) {
        return;
      }
      const bootstrapProjectRef = scopeProjectRef(
        payload.environment.environmentId,
        payload.bootstrapProjectId,
      );
      const bootstrapProject = selectProjectByRef(useStore.getState(), bootstrapProjectRef);
      const bootstrapProjectKey =
        (bootstrapProject ? deriveLogicalProjectKey(bootstrapProject) : null) ??
        (serverConfig?.cwd
          ? derivePhysicalProjectKeyFromPath(payload.environment.environmentId, serverConfig.cwd)
          : scopedProjectKey(bootstrapProjectRef));
      useUiStateStore.getState().setProjectExpanded(bootstrapProjectKey, true);
    })().catch((error) => {
      console.error("Failed to handle server lifecycle welcome.", error);
    });
  });

  const handleServerConfigUpdated = useEffectEvent(
    (notification: ServerConfigUpdatedNotification | null) => {
      if (!notification) return;

      const { id, payload, source } = notification;
      if (id <= seenServerConfigUpdateIdRef.current) {
        return;
      }
      seenServerConfigUpdateIdRef.current = id;
      if (source !== "keybindingsUpdated") {
        return;
      }

      const issue = payload.issues.find((entry) => entry.kind.startsWith("keybindings."));
      if (!issue) {
        toastManager.add({
          type: "success",
          title: "Keybindings updated",
          description: "Keybindings configuration reloaded successfully.",
        });
        return;
      }

      toastManager.add({
        type: "warning",
        title: "Invalid keybindings configuration",
        description: issue.message,
        actionProps: {
          children: "Open keybindings.json",
          onClick: () => {
            const api = readLocalApi();
            if (!api) {
              return;
            }

            void api.server
              .getConfig()
              .then((config) => {
                const editor = resolveAndPersistPreferredEditor(config.availableEditors);
                if (!editor) {
                  throw new Error("No available editors found.");
                }
                return api.shell.openInEditor(config.keybindingsConfigPath, editor);
              })
              .catch((error) => {
                toastManager.add({
                  type: "error",
                  title: "Unable to open keybindings file",
                  description:
                    error instanceof Error ? error.message : "Unknown error opening file.",
                });
              });
          },
        },
      });
    },
  );

  useEffect(() => {
    if (!serverEnvironment) {
      return;
    }

    updatePrimaryEnvironmentDescriptor(serverEnvironment);
    setActiveEnvironmentId(serverEnvironment.environmentId);

    if (
      selectEnvironmentState(useStore.getState(), serverEnvironment.environmentId).bootstrapComplete
    ) {
      return;
    }

    let disposed = false;
    void (async () => {
      await ensureEnvironmentConnectionBootstrapped(serverEnvironment.environmentId);
      if (disposed) {
        return;
      }
    })().catch((error) => {
      console.error("Failed to bootstrap server environment connection.", error);
    });

    return () => {
      disposed = true;
    };
  }, [serverEnvironment, setActiveEnvironmentId]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  useServerWelcomeSubscription(handleWelcome);
  useServerConfigUpdatedSubscription(handleServerConfigUpdated);

  return null;
}
