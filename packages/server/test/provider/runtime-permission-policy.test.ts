import { assert, describe, it } from "@effect/vitest";

import type { RuntimeMode } from "@multi/contracts";
import {
  actionFromAcpPermissionKind,
  actionFromCanonicalRequestType,
  actionFromPermissionKey,
  buildOpenCodePermissionRuleset,
  isEnvFileReference,
  shouldPromptForAction,
  type RuntimePermissionAction,
} from "../../src/provider/runtime-permission-policy.ts";

const modes: ReadonlyArray<RuntimeMode> = ["full-access", "auto-accept-edits", "approval-required"];

describe("runtime permission policy", () => {
  it("allows reads and user input while prompting for mutating or unknown actions outside full access", () => {
    const expectations: Record<RuntimePermissionAction, boolean> = {
      read: false,
      user_input: false,
      env_read: true,
      edit: true,
      command: true,
      external: true,
      unknown: true,
    };

    for (const mode of modes) {
      for (const [action, expected] of Object.entries(expectations)) {
        assert.equal(
          shouldPromptForAction(mode, action as RuntimePermissionAction),
          mode === "full-access" ? false : expected,
          `${mode}:${action}`,
        );
      }
    }
  });

  it("classifies provider permission keys", () => {
    assert.equal(actionFromPermissionKey("read"), "read");
    assert.equal(actionFromPermissionKey("grep"), "read");
    assert.equal(actionFromPermissionKey("edit"), "edit");
    assert.equal(actionFromPermissionKey("bash"), "command");
    assert.equal(actionFromPermissionKey("external_directory"), "external");
    assert.equal(actionFromPermissionKey("question"), "user_input");
    assert.equal(actionFromPermissionKey("mcp_server_tool"), "unknown");
  });

  it("classifies canonical and ACP request types", () => {
    assert.equal(actionFromCanonicalRequestType("file_read_approval"), "read");
    assert.equal(actionFromCanonicalRequestType("file_change_approval"), "edit");
    assert.equal(actionFromCanonicalRequestType("exec_command_approval"), "command");
    assert.equal(actionFromCanonicalRequestType("permissions_approval"), "unknown");
    assert.equal(actionFromAcpPermissionKind("read"), "read");
    assert.equal(actionFromAcpPermissionKind("move"), "edit");
    assert.equal(actionFromAcpPermissionKind("execute"), "command");
  });

  it("detects env file references without matching examples", () => {
    assert.equal(isEnvFileReference("/repo/.env"), true);
    assert.equal(isEnvFileReference("/repo/prod.env"), true);
    assert.equal(isEnvFileReference({ path: "/repo/.env.local" }), true);
    assert.equal(isEnvFileReference("/repo/.env.example"), false);
    assert.equal(isEnvFileReference("/repo/src/index.ts"), false);
  });

  it("builds OpenCode rules that allow safe reads and ask on edits", () => {
    const supervised = buildOpenCodePermissionRuleset("approval-required");
    assert.deepEqual(
      supervised.find((rule) => rule.permission === "*"),
      {
        permission: "*",
        pattern: "*",
        action: "ask",
      },
    );
    assert.deepEqual(
      supervised.find((rule) => rule.permission === "read" && rule.pattern === "*"),
      {
        permission: "read",
        pattern: "*",
        action: "allow",
      },
    );
    assert.deepEqual(
      supervised.find((rule) => rule.permission === "edit"),
      {
        permission: "edit",
        pattern: "*",
        action: "ask",
      },
    );
    assert.deepEqual(buildOpenCodePermissionRuleset("full-access"), [
      { permission: "*", pattern: "*", action: "allow" },
    ]);
  });
});
