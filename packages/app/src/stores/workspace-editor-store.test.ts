import { describe, expect, it } from "vitest";

import {
  getWorkspaceFullscreenTarget,
  resolveWorkspaceThreadFullscreenKey,
  workspaceEditorActions,
} from "./workspace-editor-store";

describe("workspace editor fullscreen scope", () => {
  it("scopes fullscreen by workspace and thread", () => {
    const workspaceKey = "workspace-editor-store:test-scope";

    workspaceEditorActions.toggleFullscreen(workspaceKey, "thread-a", "right-workbench");

    expect(getWorkspaceFullscreenTarget(workspaceKey, "thread-a")).toBe("right-workbench");
    expect(getWorkspaceFullscreenTarget(workspaceKey, "thread-b")).toBe("none");
    expect(getWorkspaceFullscreenTarget("workspace-editor-store:other", "thread-a")).toBe("none");

    workspaceEditorActions.toggleFullscreen(workspaceKey, "thread-a", "right-workbench");

    expect(getWorkspaceFullscreenTarget(workspaceKey, "thread-a")).toBe("none");
  });

  it("keeps null thread scope distinct from real thread ids", () => {
    const workspaceKey = "workspace-editor-store:test-null-scope";

    expect(resolveWorkspaceThreadFullscreenKey(workspaceKey, null)).not.toBe(
      resolveWorkspaceThreadFullscreenKey(workspaceKey, "none"),
    );
  });
});
