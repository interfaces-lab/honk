import { createOpenCodeServer, openCodeSessionRef, type OpenCodeClient } from "@honk/opencode";
import { describe, expect, it, vi } from "vitest";

import { createChangesResource, fileStatusGlyph } from "./workbench-changes";

const server = createOpenCodeServer({ origin: "http://127.0.0.1:4096" });
const ref = openCodeSessionRef(server.key, "ses_changes");

function changesClient(input?: {
  readonly files?: Awaited<ReturnType<OpenCodeClient["vcs"]["status"]>>;
  readonly diffs?: Awaited<ReturnType<OpenCodeClient["vcs"]["diff"]>>;
  readonly error?: Error;
}): Pick<OpenCodeClient, "vcs"> {
  return {
    vcs: {
      info: vi.fn(() =>
        input?.error === undefined
          ? Promise.resolve({ branch: "codex/utility-tabs" })
          : Promise.reject(input.error),
      ),
      status: vi.fn(() => Promise.resolve(input?.files ?? [])),
      diff: vi.fn(() => Promise.resolve(input?.diffs ?? [])),
    },
  };
}

async function readySnapshot(resource: ReturnType<typeof createChangesResource>) {
  resource.subscribe(() => {});
  await vi.waitFor(() => {
    expect(resource.getSnapshot().phase).toBe("ready");
  });
  const snapshot = resource.getSnapshot();
  if (snapshot.phase !== "ready") throw new Error("Expected ready changes.");
  return snapshot;
}

describe("Changes resource", () => {
  it("loads modified, added, and deleted files", async () => {
    const files = [
      { file: "src/modified.ts", additions: 3, deletions: 1, status: "modified" as const },
      { file: "src/added.ts", additions: 8, deletions: 0, status: "added" as const },
      { file: "public/deleted.png", additions: 0, deletions: 0, status: "deleted" as const },
    ];
    const client = changesClient({
      files,
      diffs: [
        {
          file: "src/modified.ts",
          additions: 3,
          deletions: 1,
          status: "modified",
          patch: "@@ -1 +1 @@\n-old\n+new",
        },
        {
          file: "public/deleted.png",
          additions: 0,
          deletions: 0,
          status: "deleted",
        },
      ],
    });
    const resource = createChangesResource(ref, "/repo", () => client);

    expect(resource.getSnapshot()).toEqual({ phase: "loading" });
    const snapshot = await readySnapshot(resource);
    expect(snapshot.branch).toBe("codex/utility-tabs");
    expect(snapshot.files).toEqual(files);
    expect(snapshot.diffs.get("src/modified.ts")?.patch).toContain("+new");
    expect(snapshot.diffs.get("public/deleted.png")?.patch).toBeUndefined();
    expect(files.map((file) => fileStatusGlyph(file.status))).toEqual(["M", "A", "D"]);
  });

  it("distinguishes a clean tree from a host error", async () => {
    const clean = createChangesResource(ref, "/clean", () => changesClient());
    const cleanSnapshot = await readySnapshot(clean);
    expect(cleanSnapshot.files).toEqual([]);

    const failed = createChangesResource(ref, "/failed", () =>
      changesClient({ error: new Error("VCS host failed") }),
    );
    failed.subscribe(() => {});
    await vi.waitFor(() => {
      expect(failed.getSnapshot()).toEqual({ phase: "error", message: "VCS host failed" });
    });
  });

  it("refreshes after a running turn becomes idle", async () => {
    const client = changesClient();
    const resource = createChangesResource(ref, "/refresh", () => client);
    await readySnapshot(resource);
    expect(client.vcs.status).toHaveBeenCalledTimes(1);

    resource.observeThreadRunning(true);
    resource.observeThreadRunning(false);
    await vi.waitFor(() => {
      expect(client.vcs.status).toHaveBeenCalledTimes(2);
    });
  });
});
