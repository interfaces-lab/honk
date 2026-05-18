import { describe, expect, it } from "vitest";
import {
  projectScriptCwd,
  projectScriptRuntimeEnv,
  setupProjectScript,
} from "@multi/shared/project-scripts";

import {
  commandForProjectScript,
  decodeProjectScriptKeybindingRule,
  keybindingValueForCommand,
  nextProjectScriptId,
  primaryProjectScript,
  PROJECT_SCRIPT_KEYBINDING_INVALID_MESSAGE,
  projectScriptIdFromCommand,
} from "./lib/project-scripts";
import { MAX_KEYBINDING_VALUE_LENGTH, type KeybindingCommand } from "@multi/contracts";

describe("projectScripts helpers", () => {
  it("builds and parses script run commands", () => {
    const command = commandForProjectScript("lint");
    expect(command).toBe("script.lint.run");
    expect(projectScriptIdFromCommand(command)).toBe("lint");
    expect(projectScriptIdFromCommand("terminal.toggle")).toBeNull();
  });

  it("slugifies and dedupes project script ids", () => {
    expect(nextProjectScriptId("Run Tests", [])).toBe("run-tests");
    expect(nextProjectScriptId("Run Tests", ["run-tests"])).toBe("run-tests-2");
    expect(nextProjectScriptId("!!!", [])).toBe("script");
  });

  it("resolves primary and setup scripts", () => {
    const scripts = [
      {
        id: "setup",
        name: "Setup",
        command: "bun install",
        icon: "configure" as const,
        runOnWorktreeCreate: true,
      },
      {
        id: "test",
        name: "Test",
        command: "bun test",
        icon: "test" as const,
        runOnWorktreeCreate: false,
      },
    ];

    expect(primaryProjectScript(scripts)?.id).toBe("test");
    expect(setupProjectScript(scripts)?.id).toBe("setup");
  });

  it("builds default runtime env for scripts", () => {
    const env = projectScriptRuntimeEnv({
      project: { cwd: "/repo" },
      worktreePath: "/repo/worktree-a",
    });

    expect(env).toMatchObject({
      MULTI_PROJECT_ROOT: "/repo",
      MULTI_WORKTREE_PATH: "/repo/worktree-a",
    });
  });

  it("allows overriding runtime env values", () => {
    const env = projectScriptRuntimeEnv({
      project: { cwd: "/repo" },
      extraEnv: {
        MULTI_PROJECT_ROOT: "/custom-root",
        CUSTOM_FLAG: "1",
      },
    });

    expect(env.MULTI_PROJECT_ROOT).toBe("/custom-root");
    expect(env.CUSTOM_FLAG).toBe("1");
    expect(env.MULTI_WORKTREE_PATH).toBeUndefined();
  });

  it("prefers the worktree path for script cwd resolution", () => {
    expect(
      projectScriptCwd({
        project: { cwd: "/repo" },
        worktreePath: "/repo/worktree-a",
      }),
    ).toBe("/repo/worktree-a");
    expect(
      projectScriptCwd({
        project: { cwd: "/repo" },
        worktreePath: null,
      }),
    ).toBe("/repo");
  });

  it("decodes and trims valid keybinding rules", () => {
    const rule = decodeProjectScriptKeybindingRule({
      keybinding: "  mod+k  ",
      command: commandForProjectScript("lint"),
    });

    expect(rule).toEqual({
      key: "mod+k",
      command: "script.lint.run",
    });
  });

  it("returns null when keybinding is empty", () => {
    expect(
      decodeProjectScriptKeybindingRule({
        keybinding: "   ",
        command: commandForProjectScript("lint"),
      }),
    ).toBeNull();
  });

  it("rejects invalid project script keybindings", () => {
    expect(() =>
      decodeProjectScriptKeybindingRule({
        keybinding: "k".repeat(MAX_KEYBINDING_VALUE_LENGTH + 1),
        command: commandForProjectScript("lint"),
      }),
    ).toThrowError(PROJECT_SCRIPT_KEYBINDING_INVALID_MESSAGE);
    expect(() =>
      decodeProjectScriptKeybindingRule({
        keybinding: "mod+k",
        command: "script.BAD.run" as KeybindingCommand,
      }),
    ).toThrowError(PROJECT_SCRIPT_KEYBINDING_INVALID_MESSAGE);
  });

  it("reads latest matching keybinding value for a command", () => {
    const command = commandForProjectScript("test");
    const value = keybindingValueForCommand(
      [
        {
          command,
          shortcut: {
            key: "escape",
            metaKey: false,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            modKey: true,
          },
        },
        {
          command,
          shortcut: {
            key: "k",
            metaKey: false,
            ctrlKey: false,
            shiftKey: true,
            altKey: false,
            modKey: true,
          },
        },
      ],
      command,
    );

    expect(value).toBe("mod+shift+k");
  });
});
