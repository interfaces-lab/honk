import { createOpenCodeServer, openCodeSessionRef, type OpenCodeClient } from "@honk/opencode";
import { describe, expect, it, vi } from "vitest";

import { createChangesResource, fileStatusGlyph } from "./workbench-changes";

const server = createOpenCodeServer({ origin: "http://127.0.0.1:4096" });
const ref = openCodeSessionRef(server.key, "ses_changes");

function changesClient(input?: {
  readonly files?: Awaited<ReturnType<OpenCodeClient["vcs"]["status"]>>;
  readonly diffs?: Awaited<ReturnType<OpenCodeClient["vcs"]["diff"]>>;
  readonly branchDiffs?: Awaited<ReturnType<OpenCodeClient["vcs"]["diff"]>>;
  readonly turnDiffs?: Awaited<ReturnType<OpenCodeClient["sessions"]["lastTurnDiff"]>>;
  readonly defaultBranch?: string;
  readonly error?: Error;
}) {
  return {
    vcs: {
      info: vi.fn(() =>
        input?.error === undefined
          ? Promise.resolve({
              branch: "codex/utility-tabs",
              ...(input?.defaultBranch === undefined
                ? {}
                : { default_branch: input.defaultBranch }),
            })
          : Promise.reject(input.error),
      ),
      status: vi.fn(() => Promise.resolve(input?.files ?? [])),
      diff: vi.fn((query: { readonly mode: "git" | "branch" }) =>
        Promise.resolve((query.mode === "branch" ? input?.branchDiffs : input?.diffs) ?? []),
      ),
    },
    sessions: {
      lastTurnDiff: vi.fn(() => Promise.resolve(input?.turnDiffs ?? [])),
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
    const resource = createChangesResource(ref, "/repo", "git", () => client);

    expect(resource.getSnapshot()).toEqual({ phase: "loading" });
    const snapshot = await readySnapshot(resource);
    expect(snapshot.branch).toBe("codex/utility-tabs");
    expect(snapshot.files).toEqual(files);
    expect(snapshot.diffs.get("src/modified.ts")?.patch).toContain("+new");
    expect(snapshot.diffs.get("public/deleted.png")?.patch).toBeUndefined();
    expect(files.map((file) => fileStatusGlyph(file.status))).toEqual(["M", "A", "D"]);
  });

  it("distinguishes a clean tree from a host error", async () => {
    const clean = createChangesResource(ref, "/clean", "git", () => changesClient());
    const cleanSnapshot = await readySnapshot(clean);
    expect(cleanSnapshot.files).toEqual([]);

    const failed = createChangesResource(ref, "/failed", "git", () =>
      changesClient({ error: new Error("VCS host failed") }),
    );
    failed.subscribe(() => {});
    await vi.waitFor(() => {
      expect(failed.getSnapshot()).toEqual({ phase: "error", message: "VCS host failed" });
    });
  });

  it("derives the merge-base scope's file list from its diff and reports the default branch", async () => {
    const client = changesClient({
      defaultBranch: "main",
      files: [{ file: "src/working-tree.ts", additions: 1, deletions: 0, status: "modified" }],
      branchDiffs: [
        { file: "src/committed.ts", additions: 4, deletions: 2, patch: "@@ -1 +1 @@" },
        { file: "src/added.ts", additions: 7, deletions: 0, status: "added" },
      ],
    });
    const resource = createChangesResource(ref, "/repo-branch", "branch", () => client);

    const snapshot = await readySnapshot(resource);
    expect(snapshot.defaultBranch).toBe("main");
    // `vcs.status` describes the working tree only, so it must not feed this scope.
    expect(client.vcs.status).not.toHaveBeenCalled();
    expect(snapshot.files).toEqual([
      { file: "src/committed.ts", additions: 4, deletions: 2, status: "modified" },
      { file: "src/added.ts", additions: 7, deletions: 0, status: "added" },
    ]);
    expect(snapshot.diffsPending).toBe(false);
    expect(snapshot.diffs.get("src/committed.ts")?.patch).toBe("@@ -1 +1 @@");
  });

  it("reads the last-turn scope from the session diff instead of the working tree", async () => {
    const client = changesClient({
      files: [{ file: "src/working-tree.ts", additions: 1, deletions: 0, status: "modified" }],
      turnDiffs: [{ file: "src/turn.ts", additions: 5, deletions: 3, status: "modified" }],
    });
    const resource = createChangesResource(ref, "/repo-turn", "lastTurn", () => client);

    const snapshot = await readySnapshot(resource);
    expect(client.vcs.status).not.toHaveBeenCalled();
    expect(client.vcs.diff).not.toHaveBeenCalled();
    expect(snapshot.files).toEqual([
      { file: "src/turn.ts", additions: 5, deletions: 3, status: "modified" },
    ]);
  });

  it("keeps a resource per scope so switching back does not clobber the other", async () => {
    const client = changesClient({ defaultBranch: "main" });
    expect(createChangesResource(ref, "/repo-keys", "git", () => client)).not.toBe(
      createChangesResource(ref, "/repo-keys", "branch", () => client),
    );
  });

  it("refreshes after a running turn becomes idle", async () => {
    const client = changesClient();
    const resource = createChangesResource(ref, "/refresh", "git", () => client);
    await readySnapshot(resource);
    expect(client.vcs.status).toHaveBeenCalledTimes(1);

    resource.observeThreadRunning(true);
    resource.observeThreadRunning(false);
    await vi.waitFor(() => {
      expect(client.vcs.status).toHaveBeenCalledTimes(2);
    });
  });
});
