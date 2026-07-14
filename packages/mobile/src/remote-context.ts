import * as React from "react";
import type { SidecarClient, WorkspaceState } from "@honk/opencode";

export type RemoteStatus =
  | "restoring"
  | "disconnected"
  | "connecting"
  | "live"
  | "reconnecting"
  | "closed"
  | "unauthorized"
  | "failed";

export interface ConnectRemoteInput {
  readonly origin: string;
  readonly password: string;
  readonly defaultCwd: string;
}

export interface RemoteContextValue {
  readonly client: SidecarClient | null;
  readonly workspace: WorkspaceState | null;
  readonly status: RemoteStatus;
  readonly origin: string | null;
  readonly defaultCwd: string;
  readonly error: string | null;
  readonly hasCredential: boolean;
  readonly connect: (input: ConnectRemoteInput) => Promise<void>;
  readonly retry: () => Promise<void>;
  readonly refreshWorkspace: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly setDefaultCwd: (cwd: string) => Promise<void>;
}

export const RemoteContext = React.createContext<RemoteContextValue | null>(null);

export const useRemote = (): RemoteContextValue => {
  const value = React.useContext(RemoteContext);
  if (value === null) throw new Error("useRemote must be used inside RemoteProvider");
  return value;
};
