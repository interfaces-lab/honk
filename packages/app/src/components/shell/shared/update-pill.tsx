import { IconChevronRightMedium, IconCloudDownload } from "central-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { isElectron } from "~/env";
import {
  setDesktopUpdateStateQueryData,
  useDesktopUpdateState,
} from "~/lib/desktop-update-react-query";
import {
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  resolveDesktopUpdateButtonAction,
  shouldShowDesktopUpdateButton,
} from "../../desktop-update-state";
import { toast } from "sonner";

export function UpdatePill() {
  const qc = useQueryClient();
  const state = useDesktopUpdateState().data ?? null;
  const [dismissed, setDismissed] = useState(false);

  const disabled = state?.status === "downloading";
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
      if (!window.confirm(getDesktopUpdateInstallConfirmationMessage(state))) return;
      void bridge.installUpdate().then((result) => {
        setDesktopUpdateStateQueryData(qc, result.state);
      });
    }
  };

  if (!isElectron || !shouldShowDesktopUpdateButton(state) || dismissed) return null;

  return (
    <button
      type="button"
      title={state ? getDesktopUpdateButtonTooltip(state) : ""}
      disabled={disabled}
      onClick={handle}
      onDoubleClick={() => setDismissed(true)}
      className="flex w-full select-none items-center justify-start gap-2 rounded-multi-control px-0 py-1.5 text-left text-body font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
    >
      {action === "install" ? (
        <>
          <IconChevronRightMedium className="size-4 shrink-0" />
          <span className="truncate">
            {state?.errorContext === "install" && typeof state.message === "string"
              ? "Retry update"
              : "Restart to update"}
          </span>
        </>
      ) : state?.status === "downloading" ? (
        <>
          <IconCloudDownload className="size-4 shrink-0 animate-pulse" />
          <span className="truncate">
            Downloading
            {typeof state.downloadPercent === "number"
              ? ` ${Math.floor(state.downloadPercent)}%`
              : "..."}
          </span>
        </>
      ) : (
        <>
          <IconCloudDownload className="size-4 shrink-0" />
          <span className="truncate">Update available</span>
        </>
      )}
    </button>
  );
}
