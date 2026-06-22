import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  type LexicalNode,
} from "lexical";

import { isCollapsedCursorAdjacentToInlineToken } from "../prompt-triggers";
import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import type { ComposerPromptEditorPluginHelpers } from "./plugin-types";

export function ComposerInlineTokenArrowPlugin({
  readCollapsedLengthFromEditorState,
  readSnapshotFromEditorState,
  setSelectionAtTextOffset,
}: Pick<
  ComposerPromptEditorPluginHelpers,
  "readCollapsedLengthFromEditorState" | "readSnapshotFromEditorState" | "setSelectionAtTextOffset"
>) {
  const [editor] = useLexicalComposerContext();

  useLayoutSyncEffect(() => {
    const unregisterLeft = editor.registerCommand(
      KEY_ARROW_LEFT_COMMAND,
      (event) => {
        let nextOffset: number | null = null;
        editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
          const snapshot = readSnapshotFromEditorState();
          if (snapshot.cursor <= 0) return;
          if (!isCollapsedCursorAdjacentToInlineToken(snapshot.value, snapshot.cursor, "left")) {
            return;
          }
          nextOffset = snapshot.cursor - 1;
        });
        if (nextOffset === null) return false;
        const selectionOffset = nextOffset;
        event?.preventDefault();
        event?.stopPropagation();
        editor.update(() => {
          setSelectionAtTextOffset(selectionOffset, "collapsed");
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const unregisterRight = editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      (event) => {
        let nextOffset: number | null = null;
        editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
          const snapshot = readSnapshotFromEditorState();
          const editorLength = readCollapsedLengthFromEditorState();
          if (snapshot.cursor >= editorLength) return;
          if (!isCollapsedCursorAdjacentToInlineToken(snapshot.value, snapshot.cursor, "right")) {
            return;
          }
          nextOffset = snapshot.cursor + 1;
        });
        if (nextOffset === null) return false;
        const selectionOffset = nextOffset;
        event?.preventDefault();
        event?.stopPropagation();
        editor.update(() => {
          setSelectionAtTextOffset(selectionOffset, "collapsed");
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    return () => {
      unregisterLeft();
      unregisterRight();
    };
  }, [
    editor,
    readCollapsedLengthFromEditorState,
    readSnapshotFromEditorState,
    setSelectionAtTextOffset,
  ]);

  return null;
}

export function ComposerInlineTokenSelectionNormalizePlugin({
  isComposerAtomNode,
  offsetBeforePoint,
  pointAroundNode,
  setSelectionAtTextOffset,
}: Pick<
  ComposerPromptEditorPluginHelpers,
  "isComposerAtomNode" | "offsetBeforePoint" | "pointAroundNode" | "setSelectionAtTextOffset"
>) {
  const [editor] = useLexicalComposerContext();

  useLayoutSyncEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      let afterOffset: number | null = null;
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
        const anchorNode = selection.anchor.getNode();
        if (!isComposerAtomNode(anchorNode) || selection.anchor.offset === 0) return;
        afterOffset = offsetBeforePoint(pointAroundNode(anchorNode, false), "collapsed") + 1;
      });
      if (afterOffset !== null) {
        const selectionOffset = afterOffset;
        queueMicrotask(() => {
          editor.update(() => {
            setSelectionAtTextOffset(selectionOffset, "collapsed");
          });
        });
      }
    });
  }, [editor, isComposerAtomNode, offsetBeforePoint, pointAroundNode, setSelectionAtTextOffset]);

  return null;
}

export function ComposerInlineTokenBackspacePlugin({
  isComposerAtomNode,
  offsetBeforePoint,
  pointAroundNode,
  setSelectionAtTextOffset,
}: Pick<
  ComposerPromptEditorPluginHelpers,
  "isComposerAtomNode" | "offsetBeforePoint" | "pointAroundNode" | "setSelectionAtTextOffset"
>) {
  const [editor] = useLexicalComposerContext();

  useLayoutSyncEffect(() => {
    return editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false;
        }

        const anchorNode = selection.anchor.getNode();
        const removeAtomNode = (candidate: LexicalNode | null | undefined): boolean => {
          if (!isComposerAtomNode(candidate)) {
            return false;
          }
          const tokenStart = offsetBeforePoint(pointAroundNode(candidate, false), "collapsed");
          candidate.remove();
          setSelectionAtTextOffset(tokenStart, "collapsed");
          event?.preventDefault();
          event?.stopPropagation();
          return true;
        };

        if (removeAtomNode(anchorNode)) {
          return true;
        }

        if ($isTextNode(anchorNode)) {
          if (selection.anchor.offset > 0) {
            return false;
          }
          if (removeAtomNode(anchorNode.getPreviousSibling())) {
            return true;
          }
          const parent = anchorNode.getParent();
          if ($isElementNode(parent)) {
            const index = anchorNode.getIndexWithinParent();
            if (index > 0 && removeAtomNode(parent.getChildAtIndex(index - 1))) {
              return true;
            }
          }
          return false;
        }

        if ($isElementNode(anchorNode)) {
          const childIndex = selection.anchor.offset - 1;
          if (childIndex >= 0 && removeAtomNode(anchorNode.getChildAtIndex(childIndex))) {
            return true;
          }
        }

        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, isComposerAtomNode, offsetBeforePoint, pointAroundNode, setSelectionAtTextOffset]);

  return null;
}
