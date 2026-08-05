// The wire contract: every RPC tag exists and every error carries its stable
// code. Behavior lives in the sibling files in this directory.

import { describe, expect, it } from "@effect/vitest";

import { Files } from "../../src/files";
import { Workspace } from "../../src/workspace";

describe("files contract", () => {
  it("defines typed RPCs with stable tags and error codes", () => {
    expect(Files.Find._tag).toBe("files.find");
    expect(Files.Rpcs.requests.get("files.list")).toBe(Files.List);
    expect(Files.Rpcs.requests.get("files.read")).toBe(Files.Read);
    expect(Files.Rpcs.requests.get("files.write")).toBe(Files.Write);
    expect(Files.Rpcs.requests.get("files.delete")).toBe(Files.Delete);
    expect(Files.Rpcs.requests.get("files.create_directory")).toBe(Files.CreateDirectory);
    expect(Files.Rpcs.requests.get("files.rename")).toBe(Files.Rename);

    expect(
      new Files.EscapeError({ workspaceId: Workspace.WorkspaceId.make("w"), path: "../x" }).code,
    ).toBe("files.path_escaped");
    expect(new Files.NotFoundError({ path: "x" }).code).toBe("files.not_found");
    expect(new Files.AccessError({ path: "x" }).code).toBe("files.access_denied");
    expect(new Files.ExistsError({ path: "x" }).code).toBe("files.already_exists");
    expect(new Files.OperationError({ path: "x", reason: "invalid" }).code).toBe(
      "files.operation_failed",
    );
  });
});
