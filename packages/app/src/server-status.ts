import type { OpenCodeServerConnection } from "./server-store";

export interface ServerStatusPresentation {
  readonly tone: "ok" | "warn" | "err" | "neutral";
  readonly label: "Done" | "Working" | "Needs you" | "Failed";
  readonly detail: "Connected" | "Connecting" | "Reconnecting" | "Sign in needed" | "Failed";
  readonly pulse: boolean;
}

export function serverStatus(status: OpenCodeServerConnection["status"]): ServerStatusPresentation {
  switch (status) {
    case "live":
      return { tone: "ok", label: "Done", detail: "Connected", pulse: false };
    case "connecting":
      return { tone: "neutral", label: "Working", detail: "Connecting", pulse: true };
    case "reconnecting":
    case "closed":
      return { tone: "neutral", label: "Working", detail: "Reconnecting", pulse: true };
    case "unauthorized":
    case "credential-missing":
      return { tone: "warn", label: "Needs you", detail: "Sign in needed", pulse: false };
    case "failed":
      return { tone: "err", label: "Failed", detail: "Failed", pulse: false };
  }
}
