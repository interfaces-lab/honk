import { describe, expect, it } from "vitest";

import type { Workspace } from "@honk/core/workspace";

import type { StartEvent, StartState } from "./start-model";
import { initialState, reduce } from "./start-model";

const fold = (events: readonly StartEvent[], from: StartState = initialState): StartState =>
  events.reduce(reduce, from);

const workspaceId = "ws-1" as Workspace.WorkspaceId;

const readyResult: Extract<Workspace.OpenResult, { type: "ready" }> = {
  type: "ready",
  id: workspaceId,
  directory: "/tmp/repo",
} as Extract<Workspace.OpenResult, { type: "ready" }>;

const trustRequired = {
  type: "trust_required",
  directory: "/tmp/repo",
} as Extract<Workspace.OpenResult, { type: "trust_required" }>;

describe("chat start machine", () => {
  it("starts on the picker", () => {
    expect(initialState).toEqual({ step: "pick", error: null });
  });

  it("walks pick → opening → trust → trusting → opening → ready", () => {
    const opening = fold([{ type: "directory_chosen", directory: "/tmp/repo" }]);
    expect(opening).toEqual({ step: "opening", directory: "/tmp/repo" });

    const trust = fold([{ type: "open_result", result: trustRequired }], opening);
    expect(trust).toEqual({ step: "trust", directory: "/tmp/repo" });

    const trusting = fold([{ type: "trust_accepted" }], trust);
    expect(trusting).toEqual({ step: "trusting", directory: "/tmp/repo" });

    const reopened = fold([{ type: "trust_confirmed" }], trusting);
    expect(reopened).toEqual({ step: "opening", directory: "/tmp/repo" });

    const ready = fold([{ type: "open_result", result: readyResult }], reopened);
    expect(ready).toEqual({ step: "ready", directory: "/tmp/repo", workspaceId });
  });

  it("declining trust returns to the picker without an error", () => {
    const trust = fold([
      { type: "directory_chosen", directory: "/tmp/repo" },
      { type: "open_result", result: trustRequired },
    ]);
    expect(fold([{ type: "trust_declined" }], trust)).toEqual({ step: "pick", error: null });
  });

  it("creating leaves ready exactly once and failures land on the picker", () => {
    const ready = fold([
      { type: "directory_chosen", directory: "/tmp/repo" },
      { type: "open_result", result: readyResult },
    ]);
    const creating = fold([{ type: "create_started" }], ready);
    expect(creating).toEqual({ step: "creating", directory: "/tmp/repo" });

    // A stale second click cannot re-enter creating.
    expect(fold([{ type: "create_started" }], creating)).toBe(creating);

    expect(fold([{ type: "request_failed", message: "models.no_model: nothing" }], creating)).toEqual(
      { step: "pick", error: "models.no_model: nothing" },
    );
  });

  it("ignores stale async completions in unrelated steps", () => {
    const ready = fold([
      { type: "directory_chosen", directory: "/tmp/repo" },
      { type: "open_result", result: readyResult },
    ]);
    // A late open_result from an abandoned attempt changes nothing.
    expect(fold([{ type: "open_result", result: trustRequired }], ready)).toBe(ready);
    // Trust events outside the trust step change nothing.
    expect(fold([{ type: "trust_accepted" }], ready)).toBe(ready);
  });

  it("closing the workspace returns to the picker", () => {
    const ready = fold([
      { type: "directory_chosen", directory: "/tmp/repo" },
      { type: "open_result", result: readyResult },
    ]);
    expect(fold([{ type: "workspace_closed" }], ready)).toEqual({ step: "pick", error: null });
  });
});
