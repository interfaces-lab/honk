import type { ResolvedKeybindingsConfig } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import { resolveShortcutCommand } from "../../../keybindings";

const COMPOSER_SEND: ResolvedKeybindingsConfig = [
  {
    command: "composer.send",
    shortcut: {
      key: "enter",
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      modKey: false,
    },
    whenAst: { type: "identifier", name: "composerFocus" },
  },
];

const COMPOSER_CYCLE_MODE: ResolvedKeybindingsConfig = [
  {
    command: "composer.cycleInteractionMode",
    shortcut: {
      key: "tab",
      metaKey: false,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      modKey: false,
    },
    whenAst: { type: "not", node: { type: "identifier", name: "terminalFocus" } },
  },
];

describe("Composer send keybinding", () => {
  it("maps Enter to composer.send when the composer is focused", () => {
    expect(
      resolveShortcutCommand(
        { key: "Enter", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false },
        COMPOSER_SEND,
        { context: { composerFocus: true } },
      ),
    ).toBe("composer.send");
  });

  it("leaves Shift+Enter unbound so the editor keeps newline behavior", () => {
    expect(
      resolveShortcutCommand(
        { key: "Enter", metaKey: false, ctrlKey: false, shiftKey: true, altKey: false },
        COMPOSER_SEND,
        { context: { composerFocus: true } },
      ),
    ).toBeNull();
  });
});

describe("Composer interaction mode keybinding", () => {
  it("maps Shift+Tab to composer.cycleInteractionMode when the composer is focused", () => {
    expect(
      resolveShortcutCommand(
        { key: "Tab", metaKey: false, ctrlKey: false, shiftKey: true, altKey: false },
        COMPOSER_CYCLE_MODE,
        { context: { composerFocus: true, terminalFocus: false } },
      ),
    ).toBe("composer.cycleInteractionMode");
  });

  it("does not cycle interaction mode while the terminal is focused", () => {
    expect(
      resolveShortcutCommand(
        { key: "Tab", metaKey: false, ctrlKey: false, shiftKey: true, altKey: false },
        COMPOSER_CYCLE_MODE,
        { context: { composerFocus: true, terminalFocus: true } },
      ),
    ).toBeNull();
  });
});
