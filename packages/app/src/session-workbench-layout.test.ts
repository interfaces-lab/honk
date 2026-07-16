import { createOpenCodeServer, openCodeLocationRef, openCodeSessionRef } from "@honk/opencode";
import { describe, expect, it } from "vitest";

import {
  retainResolvedWorkbenchFrame,
  workbenchWorkspaceKey,
  type ResolvedWorkbenchFrame,
} from "./workbench-frame";

const server = createOpenCodeServer({ origin: "http://127.0.0.1:4096", kind: "local" });

function frame(sessionID: string, workspaceKey: string): ResolvedWorkbenchFrame {
  return Object.freeze({
    workspaceKey,
    sessionRef: openCodeSessionRef(server.key, sessionID),
    directory: "/repo",
    isThreadRunning: false,
    plan: null,
    tasks: Object.freeze([]),
  });
}

describe("session workbench layout lifetime", () => {
  it("uses one React frame key for parent A to B in the same canonical workspace", () => {
    const location = openCodeLocationRef({ directory: "/repo", workspaceID: "workspace-1" });

    expect(workbenchWorkspaceKey(openCodeSessionRef(server.key, "ses_a"), location)).toBe(
      workbenchWorkspaceKey(openCodeSessionRef(server.key, "ses_b"), location),
    );
    expect(
      workbenchWorkspaceKey(
        openCodeSessionRef(server.key, "ses_b"),
        openCodeLocationRef({ directory: "/repo", workspaceID: "workspace-2" }),
      ),
    ).not.toBe(workbenchWorkspaceKey(openCodeSessionRef(server.key, "ses_a"), location));
  });

  it("retains the resolved shell during a cold session watch miss", () => {
    const retained = frame("ses_a", "workspace-1");

    expect(retainResolvedWorkbenchFrame(null, retained)).toBe(retained);
    expect(
      retainResolvedWorkbenchFrame(frame("ses_b", "workspace-1"), retained)?.sessionRef,
    ).toEqual(openCodeSessionRef(server.key, "ses_b"));
  });
});
