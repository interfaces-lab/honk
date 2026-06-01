import { describe, expect, it } from "vitest";

import { buildCursorAcpSpawnInput } from "../../../src/provider/acp/CursorAcp.ts";

describe("CursorAcp", () => {
  it("builds the default Cursor ACP command", () => {
    expect(buildCursorAcpSpawnInput(undefined, "/tmp/project")).toEqual({
      command: "agent",
      args: ["acp"],
      cwd: "/tmp/project",
    });
  });

  it("includes the configured api endpoint when present", () => {
    expect(
      buildCursorAcpSpawnInput(
        {
          binaryPath: "/usr/local/bin/agent",
          apiEndpoint: "http://localhost:3000",
        },
        "/tmp/project",
      ),
    ).toEqual({
      command: "/usr/local/bin/agent",
      args: ["-e", "http://localhost:3000", "acp"],
      cwd: "/tmp/project",
    });
  });

  it("passes --model before acp when a concrete model is selected", () => {
    expect(
      buildCursorAcpSpawnInput(undefined, "/tmp/project", {
        model: "composer-2.5",
      }),
    ).toEqual({
      command: "agent",
      args: ["--model", "composer-2.5", "acp"],
      cwd: "/tmp/project",
    });
  });

  it("uses composer-2.5-fast when fastMode is enabled", () => {
    expect(
      buildCursorAcpSpawnInput(undefined, "/tmp/project", {
        model: "composer-2.5",
        selections: [{ id: "fastMode", value: true }],
      }),
    ).toEqual({
      command: "agent",
      args: ["--model", "composer-2.5-fast", "acp"],
      cwd: "/tmp/project",
    });
  });

  it("omits --model for default/auto selection", () => {
    expect(
      buildCursorAcpSpawnInput(undefined, "/tmp/project", {
        model: "default",
      }),
    ).toEqual({
      command: "agent",
      args: ["acp"],
      cwd: "/tmp/project",
    });
  });
});
