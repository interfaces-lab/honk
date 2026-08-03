import type {
  OpenCodeClient,
  OpenCodeEvent,
  OpenCodeServerDescriptor,
  OpenCodeServerKey,
  OpenCodeSessionInfo,
  OpenCodeSessionRef,
} from "@honk/opencode";
import * as React from "react";

export type RemoteStatus =
  | "restoring"
  | "disconnected"
  | "connecting"
  | "live"
  | "reconnecting"
  | "offline"
  | "remote-setup"
  | "closed"
  | "unauthorized"
  | "failed";

export interface ConnectRemoteInput {
  readonly origin: string;
  readonly password: string;
  readonly defaultDirectory: string;
  readonly label?: string;
}

export interface PairRemoteInput {
  readonly origin: string;
  readonly serverId: string | null;
  readonly token: string;
  readonly requestId: string;
  readonly serverLabel: string;
  readonly deviceLabel: string;
  readonly defaultDirectory: string;
  readonly replace: boolean;
}

export interface PendingRemotePairing {
  readonly origin: string;
  readonly rebindOrigin: string | null;
  readonly requestId: string;
  readonly computerName: string;
  readonly status: "requesting" | "confirming" | "removing";
}

export interface PairingOutcome {
  readonly requestId: string;
  readonly origin: string;
  readonly result: "connected" | "removed" | "failed";
}

export interface RemoteServer {
  readonly descriptor: OpenCodeServerDescriptor;
  readonly environmentId: string | null;
  readonly deviceId: string | null;
  readonly serverId: string | null;
  readonly proofKeyThumbprint: string | null;
  readonly defaultDirectory: string;
  readonly status: Exclude<RemoteStatus, "restoring" | "disconnected">;
  readonly error: string | null;
}

export interface RemoteSession {
  readonly ref: OpenCodeSessionRef;
  readonly server: OpenCodeServerDescriptor;
  readonly info: OpenCodeSessionInfo;
  readonly projectDirectory: string;
  readonly status: "running" | "idle" | "failed";
  readonly needsAttention: boolean;
  readonly cached: boolean;
}

export interface RemoteContextValue {
  readonly servers: readonly RemoteServer[];
  readonly sessions: readonly RemoteSession[];
  readonly activeServerKey: OpenCodeServerKey | null;
  readonly activeServer: RemoteServer | null;
  readonly client: OpenCodeClient | null;
  readonly status: RemoteStatus;
  readonly error: string | null;
  readonly pendingPairing: PendingRemotePairing | null;
  readonly pairingOutcome: PairingOutcome | null;
  readonly hasCredential: boolean;
  readonly clientFor: (server: OpenCodeServerKey) => OpenCodeClient | null;
  readonly subscribeEvents: (
    server: OpenCodeServerKey,
    listener: (event: OpenCodeEvent) => void,
  ) => () => void;
  readonly selectServer: (server: OpenCodeServerKey) => void;
  readonly connect: (input: ConnectRemoteInput) => Promise<void>;
  readonly pair: (input: PairRemoteInput) => Promise<void>;
  readonly retryPendingPairing: () => Promise<void>;
  readonly cancelPendingPairing: () => Promise<void>;
  readonly acknowledgePairingOutcome: (requestId: string) => void;
  readonly retry: (server?: OpenCodeServerKey) => Promise<void>;
  readonly refreshSessions: (server?: OpenCodeServerKey) => Promise<void>;
  readonly disconnect: (server?: OpenCodeServerKey) => Promise<void>;
  readonly setDefaultDirectory: (server: OpenCodeServerKey, directory: string) => Promise<void>;
}

export const RemoteContext = React.createContext<RemoteContextValue | null>(null);

export const useRemote = (): RemoteContextValue => {
  const value = React.useContext(RemoteContext);
  if (value === null) throw new Error("useRemote must be used inside RemoteProvider");
  return value;
};
