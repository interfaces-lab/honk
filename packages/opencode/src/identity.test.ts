import { describe, expect, it } from "vitest";

import { createOpenCodeServer, openCodeLocationKey, openCodeLocationRef } from "./identity";

describe("OpenCode location identity", () => {
  it("distinguishes equal directories in different remote workspaces", () => {
    const server = createOpenCodeServer({ origin: "https://remote.example.test" });
    const first = openCodeLocationKey(
      server.key,
      openCodeLocationRef({ directory: "/workspace/repo", workspaceID: "workspace-a" }),
    );
    const second = openCodeLocationKey(
      server.key,
      openCodeLocationRef({ directory: "/workspace/repo", workspaceID: "workspace-b" }),
    );

    expect(first).not.toBe(second);
  });

  it("normalizes trailing separators without collapsing server identity", () => {
    const local = createOpenCodeServer({ origin: "http://127.0.0.1:4096" });
    const remote = createOpenCodeServer({ origin: "https://remote.example.test" });
    const location = openCodeLocationRef({ directory: "/workspace/repo/" });

    expect(openCodeLocationKey(local.key, location)).toBe(
      openCodeLocationKey(local.key, openCodeLocationRef({ directory: "/workspace/repo" })),
    );
    expect(openCodeLocationKey(local.key, location)).not.toBe(
      openCodeLocationKey(remote.key, location),
    );
  });
});
