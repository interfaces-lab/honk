import { OpenCodeRequestError, type OpenCodeClient } from "@honk/opencode";
import { describe, expect, it, vi } from "vitest";

import {
  createFileViewerResource,
  FILE_VIEWER_MAX_CHARACTERS,
  type FileViewerState,
} from "./workbench-file-viewer";

type FilesApi = OpenCodeClient["files"];

function client(files: Partial<FilesApi>): Pick<OpenCodeClient, "files"> {
  return { files: files as FilesApi };
}

// The resource loads on first subscribe, so settling is one microtask drain past that.
async function settle(
  files: Partial<FilesApi>,
  path = "src/value.ts",
): Promise<{ readonly state: FileViewerState; readonly refresh: () => void }> {
  const resource = createFileViewerResource("/repo", path, () => client(files));
  resource.subscribe(() => {});
  await vi.waitUntil(() => resource.getSnapshot().phase !== "loading");
  return { state: resource.getSnapshot(), refresh: resource.refresh };
}

describe("workbench file viewer content states", () => {
  it("renders decoded text and asks the sidecar for the tab's directory", async () => {
    const read = vi.fn().mockResolvedValue({ kind: "text", text: "const one = 1;\n" });

    const { state } = await settle({ read });

    expect(state).toEqual({ phase: "ready", text: "const one = 1;\n" });
    expect(read).toHaveBeenCalledWith("src/value.ts", { directory: "/repo" });
  });

  it("names the actual media type instead of rendering a binary payload", async () => {
    const { state } = await settle({
      read: vi.fn().mockResolvedValue({ kind: "binary", base64: "AAA=", mimeType: "image/png" }),
    });

    expect(state).toEqual({ phase: "binary", mimeType: "image/png" });
  });

  it("refuses a file past the render cap before building any rows", async () => {
    const text = "x".repeat(FILE_VIEWER_MAX_CHARACTERS + 1);

    const { state } = await settle({ read: vi.fn().mockResolvedValue({ kind: "text", text }) });

    expect(state).toEqual({ phase: "oversized", characters: text.length });
  });

  it("separates a deleted file from an empty one through the raw read response", async () => {
    const missing = await settle({
      read: vi
        .fn()
        .mockRejectedValue(
          new OpenCodeRequestError("fs.read", "Not found", new Response(null, { status: 404 })),
        ),
    });
    const empty = await settle({
      read: vi.fn().mockResolvedValue({ kind: "text", text: "" }),
    });

    expect(missing.state).toEqual({ phase: "missing" });
    expect(empty.state).toEqual({ phase: "empty" });
  });

  it("does not need a directory listing to recognize an empty root file", async () => {
    const list = vi.fn().mockResolvedValue({ data: [] });

    await settle(
      { read: vi.fn().mockResolvedValue({ kind: "text", text: "" }), list },
      "README.md",
    );

    expect(list).not.toHaveBeenCalled();
  });

  it("writes the current draft against the loaded contents", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const resource = createFileViewerResource("/repo", "src/value.ts", () =>
      client({ read: vi.fn(), write }),
    );

    await resource.save("const value = 1;\n", "const value = 2;\n");

    expect(write).toHaveBeenCalledWith(
      "src/value.ts",
      { expectedContents: "const value = 1;\n", contents: "const value = 2;\n" },
      { directory: "/repo" },
    );
  });

  it("reports a failed read and recovers on retry", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("fs.read failed with 500"))
      .mockResolvedValue({ kind: "text", text: "recovered" });
    const resource = createFileViewerResource("/repo", "src/value.ts", () => client({ read }));
    resource.subscribe(() => {});
    await vi.waitUntil(() => resource.getSnapshot().phase !== "loading");

    expect(resource.getSnapshot()).toEqual({
      phase: "error",
      message: "fs.read failed with 500",
    });

    resource.refresh();
    await vi.waitUntil(() => resource.getSnapshot().phase !== "loading");
    expect(resource.getSnapshot()).toEqual({ phase: "ready", text: "recovered" });
  });

  it("reports a disconnected client without calling the sidecar", async () => {
    const resource = createFileViewerResource("/repo", "src/value.ts", () => null);
    resource.subscribe(() => {});

    expect(resource.getSnapshot()).toEqual({
      phase: "error",
      message: "Honk is not connected to OpenCode.",
    });
  });

  it("rereads the file when a thread run finishes", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ kind: "text", text: "before" })
      .mockResolvedValue({ kind: "text", text: "after" });
    const resource = createFileViewerResource("/repo", "src/value.ts", () => client({ read }));
    resource.subscribe(() => {});
    await vi.waitUntil(() => resource.getSnapshot().phase !== "loading");

    resource.observeThreadRunning(true);
    resource.observeThreadRunning(false);
    // The reread keeps the previous content on screen, so the spinner never returns.
    expect(resource.getSnapshot()).toEqual({ phase: "ready", text: "before" });

    await vi.waitUntil(() => {
      const state = resource.getSnapshot();
      return state.phase === "ready" && state.text === "after";
    });
    expect(resource.getSnapshot()).toEqual({ phase: "ready", text: "after" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("drops a stale read that settles after a refresh", async () => {
    const read = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({ kind: "text", text: "stale" });
            }, 20);
          }),
      )
      .mockResolvedValue({ kind: "text", text: "fresh" });
    const resource = createFileViewerResource("/repo", "src/value.ts", () => client({ read }));
    resource.subscribe(() => {});
    resource.refresh();
    await vi.waitUntil(() => resource.getSnapshot().phase !== "loading");

    expect(resource.getSnapshot()).toEqual({ phase: "ready", text: "fresh" });
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
    expect(resource.getSnapshot()).toEqual({ phase: "ready", text: "fresh" });
  });
});
