// The wire contract: result states decode, RPC tags exist, and errors carry
// their stable codes. Behavior lives in trust.test.ts and lookup.test.ts.

import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { Workspace } from "../../src/workspace";

describe("workspace.open contract", () => {
  it.effect("decodes every public result state", () =>
    Effect.gen(function* () {
      const trustRequired = yield* Schema.decodeUnknownEffect(Workspace.OpenResult)({
        type: "trust_required",
        directory: "/workspace",
      });
      const ready = yield* Schema.decodeUnknownEffect(Workspace.OpenResult)({
        type: "ready",
        id: "workspace-1",
        directory: "/workspace",
      });

      expect(trustRequired.type).toBe("trust_required");
      expect(Workspace.OpenResult.guards.ready(ready)).toBe(true);
      if (Workspace.OpenResult.guards.ready(ready)) expect(ready.id).toBe("workspace-1");
    }),
  );

  it("defines typed RPCs with stable error contracts", () => {
    const error = new Workspace.OpenError({ directory: "/workspace" });

    expect(Workspace.Open._tag).toBe("workspace.open");
    expect(Workspace.Rpcs.requests.get("workspace.open")).toBe(Workspace.Open);
    expect(Workspace.Rpcs.requests.get("workspace.trust")).toBe(Workspace.Trust);
    expect(error.code).toBe("workspace.open_failed");
    expect(error.message).toBe("Honk could not open this workspace.");
  });
});
