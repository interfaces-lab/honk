import { createOpenCodeServer, openCodeLocationRef, openCodeSessionRef } from "@honk/opencode";
import { describe, expect, it } from "vitest";

import { workbenchWorkspaceKey } from "./workbench-frame";

const server = createOpenCodeServer({ origin: "http://127.0.0.1:4096", kind: "local" });

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

});
