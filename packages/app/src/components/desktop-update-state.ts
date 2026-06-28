import type { DesktopUpdateActionResult, DesktopUpdateState } from "@honk/contracts";

export type DesktopUpdateButtonAction = "download" | "install" | "none";

export function resolveDesktopUpdateButtonAction(
  state: DesktopUpdateState,
): DesktopUpdateButtonAction {
  if (state.status === "installing") {
    return "none";
  }
  if (state.downloadedVersion) {
    return "install";
  }
  if (state.status === "available") {
    return "download";
  }
  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return "download";
    }
  }
  return "none";
}

export function shouldShowDesktopUpdateButton(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) {
    return false;
  }
  if (state.status === "downloading") {
    return true;
  }
  if (state.status === "installing") {
    return true;
  }
  return resolveDesktopUpdateButtonAction(state) !== "none";
}

export function getDesktopUpdateButtonTooltip(state: DesktopUpdateState): string {
  if (state.status === "disabled") {
    return state.message ?? "Automatic updates are not available in this build.";
  }
  if (state.status === "checking") {
    return "Checking for updates";
  }
  if (state.status === "available") {
    return `Update ${state.availableVersion ?? "available"} ready to download`;
  }
  if (state.status === "downloading") {
    const progress =
      typeof state.downloadPercent === "number" ? ` (${Math.floor(state.downloadPercent)}%)` : "";
    return `Downloading update${progress}`;
  }
  if (state.status === "downloaded") {
    return `Update ${state.downloadedVersion ?? state.availableVersion ?? "ready"} downloaded. Click to restart and install.`;
  }
  if (state.status === "installing") {
    return `Installing update ${state.downloadedVersion ?? state.availableVersion ?? ""}`.trim();
  }
  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return `Download failed for ${state.availableVersion}. Click to retry.`;
    }
    if (state.errorContext === "install" && state.downloadedVersion) {
      return `Install failed for ${state.downloadedVersion}. Click to retry.`;
    }
    return state.message ?? "Update failed";
  }
  if (state.status === "idle") {
    return "Check for updates";
  }
  return "Honk is up to date";
}

export function getDesktopUpdateInstallConfirmationMessage(
  state: Pick<DesktopUpdateState, "availableVersion" | "downloadedVersion">,
  runningThreadTitles: readonly string[],
): string {
  const version = state.downloadedVersion ?? state.availableVersion;
  const threadList =
    runningThreadTitles.length > 0
      ? `\n\n${runningThreadTitles.map((title) => `• ${title}`).join("\n")}`
      : "";
  return `Install update${version ? ` ${version}` : ""} and restart Honk?\n\nAny running tasks will be interrupted.${threadList}\n\nMake sure you're ready before continuing.`;
}

export function shouldConfirmDesktopUpdateInstall(runningThreadCount: number): boolean {
  return runningThreadCount > 0;
}

export function getDesktopUpdateActionError(result: DesktopUpdateActionResult): string | null {
  if (!result.accepted || result.completed) return null;
  if (typeof result.state.message !== "string") return null;
  const message = result.state.message.trim();
  return message.length > 0 ? message : null;
}

export function shouldToastDesktopUpdateActionResult(result: DesktopUpdateActionResult): boolean {
  return getDesktopUpdateActionError(result) !== null;
}

export function shouldHighlightDesktopUpdateError(state: DesktopUpdateState | null): boolean {
  if (!state || state.status !== "error") return false;
  return state.errorContext === "download" || state.errorContext === "install";
}

export function canCheckForUpdate(state: DesktopUpdateState | null): boolean {
  if (!state) return false;
  return (
    state.status !== "checking" &&
    state.status !== "downloading" &&
    state.status !== "installing" &&
    state.status !== "downloaded"
  );
}
