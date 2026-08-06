import { createOpenCodeServer, type OpenCodeClient } from "@honk/opencode";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { WorkbenchChangesCard } from "./workbench-changes-card";
import {
  base64ByteLength,
  createImagePreviewResource,
  isImagePreviewPath,
  loadImagePreview,
} from "./workbench-changes-image-resource";

type FilesApi = OpenCodeClient["files"];

function imageClient(read: FilesApi["read"]): Pick<OpenCodeClient, "files"> {
  return { files: { read } as FilesApi };
}

describe("workbench Changes image preview", () => {
  it("recognizes the image formats the renderer can preview", () => {
    expect(isImagePreviewPath("assets/study.JPG")).toBe(true);
    expect(isImagePreviewPath("assets/diagram.svg")).toBe(true);
    expect(isImagePreviewPath("src/index.ts")).toBe(false);
  });

  it("loads image bytes only after an expanded preview subscribes", async () => {
    const read = vi.fn().mockResolvedValue({
      kind: "binary",
      base64: "AQIDBA==",
      mimeType: "image/jpeg",
    });
    const resource = createImagePreviewResource("/repo", "assets/study.jpg", () =>
      imageClient(read),
    );

    expect(read).not.toHaveBeenCalled();
    const unsubscribe = resource.subscribe(() => {});
    await vi.waitUntil(() => resource.getSnapshot().phase !== "loading");

    expect(read).toHaveBeenCalledWith("assets/study.jpg", { directory: "/repo" });
    expect(resource.getSnapshot()).toEqual({
      phase: "ready",
      src: "data:image/jpeg;base64,AQIDBA==",
      sizeBytes: 4,
    });
    unsubscribe();
  });

  it("turns text SVG content into an image source without changing text diffs", async () => {
    const state = await loadImagePreview(
      imageClient(vi.fn().mockResolvedValue({ kind: "text", text: "<svg></svg>" })),
      "/repo",
      "assets/mark.svg",
    );

    expect(state.phase).toBe("ready");
    if (state.phase !== "ready") return;
    expect(state.src).toBe("data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E");
  });

  it("keeps the image body absent while its row is collapsed", () => {
    const server = createOpenCodeServer({ origin: "http://127.0.0.1:4096" });
    const render = (isExpanded: boolean): string =>
      renderToStaticMarkup(
        <WorkbenchChangesCard
          file={{
            file: "assets/study.jpg",
            additions: 0,
            deletions: 0,
            status: "added",
          }}
          server={server.key}
          directory="/repo"
          patch={undefined}
          patchPending={false}
          diffStyle="unified"
          wordWrap={false}
          theme="light"
          isExpanded={isExpanded}
          onToggleExpand={vi.fn()}
          isActive={false}
          onSelect={vi.fn()}
          isViewed={false}
          onToggleViewed={vi.fn()}
          isIncluded
          onToggleInclude={vi.fn()}
          onRevert={vi.fn()}
          actionsDisabled={false}
        />,
      );

    expect(render(false)).not.toContain("Loading image preview");
    expect(render(true)).toContain("Loading image preview");
  });

  it("counts decoded bytes without allocating another binary buffer", () => {
    expect(base64ByteLength("AQIDBA==")).toBe(4);
    expect(base64ByteLength("AQI=")).toBe(2);
  });
});
