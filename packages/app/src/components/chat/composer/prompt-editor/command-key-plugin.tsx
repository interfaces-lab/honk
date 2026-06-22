import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
} from "lexical";

import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import type { ComposerCommandKey, ComposerPromptEditorPluginHelpers } from "./plugin-types";

export function ComposerCommandKeyPlugin({
  onCommandKeyDownRef,
  pendingSurroundSelectionRef,
}: Pick<
  ComposerPromptEditorPluginHelpers,
  "onCommandKeyDownRef" | "pendingSurroundSelectionRef"
>) {
  const [editor] = useLexicalComposerContext();

  useLayoutSyncEffect(() => {
    const handleCommand = (key: ComposerCommandKey, event: KeyboardEvent | null): boolean => {
      if (!event) {
        return false;
      }
      if (key === "Enter" && (event.isComposing || event.keyCode === 229)) {
        event.stopPropagation();
        return true;
      }

      const handled = onCommandKeyDownRef.current?.(key, event) ?? false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
        pendingSurroundSelectionRef.current = null;
      }
      return handled;
    };

    const unregisterArrowDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => handleCommand("ArrowDown", event),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterArrowUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => handleCommand("ArrowUp", event),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => handleCommand("Enter", event),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterEscape = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => handleCommand("Escape", event),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => handleCommand("Tab", event),
      COMMAND_PRIORITY_HIGH,
    );

    return () => {
      unregisterArrowDown();
      unregisterArrowUp();
      unregisterEnter();
      unregisterEscape();
      unregisterTab();
    };
  }, [editor, onCommandKeyDownRef, pendingSurroundSelectionRef]);

  return null;
}
