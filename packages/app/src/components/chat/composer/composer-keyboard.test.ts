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
