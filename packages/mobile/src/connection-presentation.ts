import type { RemoteServer } from "./remote-context";

export type ConnectionPresentationTone = "error" | "muted" | "success" | "warning";

export interface ConnectionPresentation {
  readonly title: string;
  readonly detail: string | null;
  readonly tone: ConnectionPresentationTone;
}

export interface ConnectionRecoveryPresentation extends ConnectionPresentation {
  readonly action: "manage" | "retry" | null;
}

export function presentRemoteServerConnection(
  server: Pick<RemoteServer, "error" | "status">,
): ConnectionPresentation {
  switch (server.status) {
    case "live":
      return { title: "Connected", detail: null, tone: "success" };
    case "offline":
      return {
        title: "Offline",
        detail: "Honk will reconnect when this phone is back online.",
        tone: "muted",
      };
    case "connecting":
      return { title: "Connecting…", detail: server.error, tone: "muted" };
    case "reconnecting":
      return {
        title: "Reconnecting…",
        detail: server.error,
        tone: "warning",
      };
    case "unauthorized":
      return {
        title: "Access needs repair",
        detail: server.error,
        tone: "error",
      };
    case "remote-setup":
      return {
        title: "Remote access setup needed",
        detail: server.error,
        tone: "warning",
      };
    case "failed":
      return {
        title: "Connection failed",
        detail: server.error,
        tone: "error",
      };
    case "closed":
      return { title: "Disconnected", detail: server.error, tone: "muted" };
  }
}

export function presentRemoteServerRecovery(
  server: Pick<RemoteServer, "error" | "status">,
): ConnectionRecoveryPresentation {
  const presentation = presentRemoteServerConnection(server);
  switch (server.status) {
    case "connecting":
    case "reconnecting":
    case "closed":
      return { ...presentation, action: "retry" };
    case "offline":
    case "unauthorized":
    case "failed":
      return { ...presentation, action: "manage" };
    case "remote-setup":
    case "live":
      return { ...presentation, action: null };
  }
}

export function homeConnectionNotice(
  servers: readonly Pick<RemoteServer, "descriptor" | "error" | "status">[],
): {
  readonly title: string;
  readonly detail: string;
  readonly tone: ConnectionPresentationTone;
} | null {
  const blocked = servers.find(
    (server) => server.status === "unauthorized" || server.status === "failed",
  );
  if (blocked !== undefined) {
    return {
      title: `${blocked.descriptor.label} needs attention`,
      detail: presentRemoteServerConnection(blocked).detail ?? "Open Computers to repair access.",
      tone: "error",
    };
  }
  const remoteSetup = servers.find((server) => server.status === "remote-setup");
  if (remoteSetup !== undefined) {
    return {
      title: `${remoteSetup.descriptor.label} needs remote access setup`,
      detail:
        presentRemoteServerConnection(remoteSetup).detail ??
        "This computer remains saved while remote access is unavailable.",
      tone: "warning",
    };
  }
  const reconnecting = servers.find(
    (server) => server.status === "connecting" || server.status === "reconnecting",
  );
  if (reconnecting !== undefined) {
    return {
      title:
        reconnecting.status === "connecting"
          ? `Connecting to ${reconnecting.descriptor.label}…`
          : `Reconnecting to ${reconnecting.descriptor.label}…`,
      detail: "This computer stays saved while Honk restores the connection.",
      tone: "warning",
    };
  }
  const offline = servers.find((server) => server.status === "offline");
  if (offline !== undefined) {
    return {
      title: "You’re offline",
      detail: "Your computers stay saved. Honk reconnects automatically when the network returns.",
      tone: "muted",
    };
  }
  return null;
}
