import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { DesktopUpdateState } from "@honk/contracts";
import { toast } from "sonner";

import { APP_VERSION } from "~/app/branding";
import { isElectron } from "~/env";
import {
  countRunningThreadsWithServerState,
  selectRunningThreadTitlesWithServerState,
} from "~/desktop-active-work";
import {
  setDesktopUpdateStateQueryData,
  useDesktopUpdateState,
} from "~/lib/desktop-update-react-query";
import { cn } from "~/lib/utils";
import { useStore } from "~/stores/thread-store";
import {
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  resolveDesktopUpdateButtonAction,
  shouldConfirmDesktopUpdateInstall,
  shouldShowDesktopUpdateButton,
  type DesktopUpdateButtonAction,
} from "../../desktop-update-state";

function formatSidebarUpdateVersion(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

function getSidebarUpdateChipLabel(
  state: DesktopUpdateState,
  action: DesktopUpdateButtonAction,
): string {
  const targetVersion = formatSidebarUpdateVersion(
    state.downloadedVersion ?? state.availableVersion ?? state.currentVersion,
  );

  if (action === "install") {
    return state.errorContext === "install" && typeof state.message === "string"
      ? `Retry · ${targetVersion}`
      : `Restart · ${targetVersion}`;
  }
  if (state.status === "installing") {
    return `Installing · ${targetVersion}`;
  }
  if (state.status === "downloading") {
    const progress =
      typeof state.downloadPercent === "number"
        ? ` ${Math.floor(state.downloadPercent)}%`
        : "";
    return `Downloading${progress}`;
  }
  return `Update · ${targetVersion}`;
}

export function UpdatePill() {
  const qc = useQueryClient();
  const state = useDesktopUpdateState().data ?? null;
  const [dismissed, setDismissed] = useState(false);

  const disabled = state?.status === "downloading" || state?.status === "installing";
  const action = state ? resolveDesktopUpdateButtonAction(state) : "none";

  const handle = () => {
    const bridge = window.desktopBridge;
    if (!bridge || !state || disabled || action === "none") return;

    if (action === "download") {
      void bridge.downloadUpdate().then((result) => {
        setDesktopUpdateStateQueryData(qc, result.state);
        if (result.completed) {
          toast.success("Update downloaded", {
            description: "Restart the app to install it.",
          });
        }
      });
      return;
    }

    if (action === "install") {
      const storeState = useStore.getState();
      const runningThreadCount = countRunningThreadsWithServerState(storeState);
      const runningThreadTitles = selectRunningThreadTitlesWithServerState(storeState);
      if (
        shouldConfirmDesktopUpdateInstall(runningThreadCount) &&
        !window.confirm(getDesktopUpdateInstallConfirmationMessage(state, runningThreadTitles))
      ) {
        return;
      }
      void bridge.installUpdate().then((result) => {
        setDesktopUpdateStateQueryData(qc, result.state);
      });
    }
  };

  if (!isElectron) return null;

  const currentVersion = formatSidebarUpdateVersion(state?.currentVersion ?? APP_VERSION);
  const showUpdateAction = Boolean(state && shouldShowDesktopUpdateButton(state) && !dismissed);

  if (!showUpdateAction) {
    return (
      <span className="truncate px-2 text-caption font-medium text-muted-foreground/60">
        {currentVersion}
      </span>
    );
  }

  return (
    <button
      type="button"
      title={state ? getDesktopUpdateButtonTooltip(state) : ""}
      disabled={disabled}
      onClick={handle}
      onDoubleClick={() => setDismissed(true)}
      className={cn(
        "inline-flex max-w-full min-h-6 select-none items-center gap-1.5 rounded-full px-2 py-0.5 text-left",
        "text-caption font-semibold text-primary",
        "bg-primary/12 shadow-[0_0_0_1px] shadow-primary/22",
        "transition-colors hover:bg-primary/18 hover:shadow-primary/32",
        "disabled:opacity-50",
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
      <span className="truncate">{state ? getSidebarUpdateChipLabel(state, action) : ""}</span>
    </button>
  );
}
