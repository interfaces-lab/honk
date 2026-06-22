import type { LexicalEditor, LexicalNode } from "lexical";
import type { RefObject } from "react";

import type {
  ComposerPromptEditorProps,
  ComposerPromptEditorSnapshot,
  LexicalSelectionPoint,
  SurroundSelectionSnapshot,
} from "./types";

export type ComposerCommandKey = "ArrowDown" | "ArrowUp" | "Enter" | "Escape" | "Tab";

export type SelectionOffsetMode = "expanded" | "collapsed";

export type ComposerPromptEditorPluginHelpers = {
  onCommandKeyDownRef: RefObject<ComposerPromptEditorProps["onCommandKeyDown"]>;
  pendingSurroundSelectionRef: RefObject<SurroundSelectionSnapshot | null>;
  readSnapshotFromEditorState: () => ComposerPromptEditorSnapshot;
  readCollapsedLengthFromEditorState: () => number;
  setSelectionAtTextOffset: (offset: number, mode: SelectionOffsetMode) => void;
  setSelectionRangeAtTextOffsets: (
    start: number,
    end: number,
    mode: SelectionOffsetMode,
  ) => void;
  isComposerAtomNode: (node: LexicalNode | null | undefined) => node is LexicalNode;
  pointAroundNode: (node: LexicalNode, after: boolean) => LexicalSelectionPoint;
  offsetBeforePoint: (point: LexicalSelectionPoint, mode: SelectionOffsetMode) => number;
  captureSurroundSelection: (editor: LexicalEditor) => SurroundSelectionSnapshot | null;
  applySurroundInput: (
    editor: LexicalEditor,
    snapshot: SurroundSelectionSnapshot,
    open: string,
    close: string,
  ) => boolean;
  backtickSurroundCloseSymbol: string | null;
  surroundSymbolsMap: ReadonlyMap<string, string>;
};
