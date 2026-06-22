import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $getSelection, $isRangeSelection, HISTORY_MERGE_TAG } from "lexical";
import { useRef } from "react";

import { collapseExpandedComposerCursor } from "../prompt-triggers";
import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import type { ComposerPromptEditorPluginHelpers } from "./plugin-types";
import type { SurroundSelectionSnapshot } from "./types";

export function ComposerSurroundSelectionPlugin({
  applySurroundInput,
  backtickSurroundCloseSymbol,
  captureSurroundSelection,
  pendingSurroundSelectionRef,
  setSelectionRangeAtTextOffsets,
  surroundSymbolsMap,
}: Pick<
  ComposerPromptEditorPluginHelpers,
  | "applySurroundInput"
  | "backtickSurroundCloseSymbol"
  | "captureSurroundSelection"
  | "pendingSurroundSelectionRef"
  | "setSelectionRangeAtTextOffsets"
  | "surroundSymbolsMap"
>) {
  const [editor] = useLexicalComposerContext();
  const pendingDeadKeySelectionRef = useRef<SurroundSelectionSnapshot | null>(null);

  useLayoutSyncEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (pendingDeadKeySelectionRef.current) {
        if (event.key === "Dead" || event.key === " " || event.code === "Space") {
          return;
        }
        pendingDeadKeySelectionRef.current = null;
      }

      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey) {
        pendingSurroundSelectionRef.current = null;
        pendingDeadKeySelectionRef.current = null;
        return;
      }
      pendingSurroundSelectionRef.current = captureSurroundSelection(editor);
    };

    const onBeforeInput = (event: InputEvent) => {
      if (
        event.inputType === "insertCompositionText" &&
        event.data === "`" &&
        backtickSurroundCloseSymbol !== null &&
        pendingSurroundSelectionRef.current
      ) {
        pendingDeadKeySelectionRef.current = pendingSurroundSelectionRef.current;
        return;
      }

      if (pendingDeadKeySelectionRef.current) {
        return;
      }

      if (event.inputType === "insertCompositionText") {
        return;
      }
      const pendingSelection = pendingSurroundSelectionRef.current;
      if (!pendingSelection) {
        return;
      }
      if (event.inputType !== "insertText" || typeof event.data !== "string") {
        pendingSurroundSelectionRef.current = null;
        return;
      }
      const close = surroundSymbolsMap.get(event.data);
      if (!close) {
        pendingSurroundSelectionRef.current = null;
        return;
      }
      if (!applySurroundInput(editor, pendingSelection, event.data, close)) {
        pendingSurroundSelectionRef.current = null;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      pendingSurroundSelectionRef.current = null;
    };

    const tryApplyDeadKeyBacktickSurround = (options?: { finalAttempt?: boolean }) => {
      queueMicrotask(() => {
        editor.update(
          () => {
            const pendingDeadKeySelection = pendingDeadKeySelectionRef.current;
            if (!pendingDeadKeySelection) {
              return;
            }

            const currentValue = $getRoot().getTextContent();
            const close = backtickSurroundCloseSymbol;
            if (close === null) {
              pendingSurroundSelectionRef.current = null;
              pendingDeadKeySelectionRef.current = null;
              return;
            }

            const expectedResolvedValue = `${pendingDeadKeySelection.value.slice(
              0,
              pendingDeadKeySelection.start,
            )}\`${pendingDeadKeySelection.value.slice(pendingDeadKeySelection.end)}`;
            if (currentValue !== expectedResolvedValue) {
              if (options?.finalAttempt) {
                pendingSurroundSelectionRef.current = null;
                pendingDeadKeySelectionRef.current = null;
              }
              return;
            }

            const selectedText = pendingDeadKeySelection.value.slice(
              pendingDeadKeySelection.start,
              pendingDeadKeySelection.end,
            );
            const replacementStart = collapseExpandedComposerCursor(
              currentValue,
              pendingDeadKeySelection.start,
            );
            setSelectionRangeAtTextOffsets(replacementStart, replacementStart + 1, "collapsed");
            const replacementSelection = $getSelection();
            if (!$isRangeSelection(replacementSelection)) {
              pendingSurroundSelectionRef.current = null;
              pendingDeadKeySelectionRef.current = null;
              return;
            }
            replacementSelection.insertText(`\`${selectedText}${close}`);
            setSelectionRangeAtTextOffsets(
              replacementStart + 1,
              replacementStart + 1 + selectedText.length,
              "collapsed",
            );
            pendingSurroundSelectionRef.current = null;
            pendingDeadKeySelectionRef.current = null;
          },
          { tag: HISTORY_MERGE_TAG },
        );
      });
    };

    const onInput = (event: Event) => {
      const inputEvent = event as InputEvent;
      if (
        inputEvent.inputType === "insertText" ||
        inputEvent.inputType === "insertCompositionText"
      ) {
        tryApplyDeadKeyBacktickSurround();
      }
    };

    const onCompositionEnd = () => {
      tryApplyDeadKeyBacktickSurround({ finalAttempt: true });
    };

    let activeRootElement: HTMLElement | null = null;
    const unregisterRootListener = editor.registerRootListener(
      (rootElement, previousRootElement) => {
        previousRootElement?.removeEventListener("keydown", onKeyDown);
        previousRootElement?.removeEventListener("beforeinput", onBeforeInput, true);
        previousRootElement?.removeEventListener("input", onInput);
        previousRootElement?.removeEventListener("compositionend", onCompositionEnd);
        rootElement?.addEventListener("keydown", onKeyDown);
        rootElement?.addEventListener("beforeinput", onBeforeInput, true);
        rootElement?.addEventListener("input", onInput);
        rootElement?.addEventListener("compositionend", onCompositionEnd);
        activeRootElement = rootElement;
      },
    );

    return () => {
      if (activeRootElement) {
        activeRootElement.removeEventListener("keydown", onKeyDown);
        activeRootElement.removeEventListener("beforeinput", onBeforeInput, true);
        activeRootElement.removeEventListener("input", onInput);
        activeRootElement.removeEventListener("compositionend", onCompositionEnd);
      }
      unregisterRootListener();
    };
  }, [
    applySurroundInput,
    backtickSurroundCloseSymbol,
    captureSurroundSelection,
    editor,
    pendingSurroundSelectionRef,
    setSelectionRangeAtTextOffsets,
    surroundSymbolsMap,
  ]);

  return null;
}
