import type { OrchestrationMessageRichText } from "@honk/contracts";
import type { ClipboardEventHandler, RefObject } from "react";
import type { LexicalEditor, NodeKey, SerializedLexicalNode } from "lexical";

export type ComposerAtomKind = "mention" | "command" | "skill" | "inline-token";

export interface ComposerCommandData {
  id: string;
  name: string;
  content: string | null;
  type: string | null;
}

export interface ComposerMentionData {
  path: string;
  label: string | null;
  lineStart: number | null;
  lineEnd: number | null;
}

export interface ComposerPromptSubmitData {
  text: string;
  richText?: OrchestrationMessageRichText | undefined;
  commands: ComposerCommandData[];
  mentions: ComposerMentionData[];
}

export interface ComposerPromptEditorSnapshot {
  value: string;
  cursor: number;
  expandedCursor: number;
}

export interface ComposerPromptEditorHandle {
  focus: () => void;
  blur: () => void;
  clear: () => void;
  focusAt: (cursor: number) => void;
  focusAtEnd: () => void;
  insertText: (text: string) => void;
  insertMention: (payload: ComposerMentionPayload) => void;
  getText: () => string;
  getCommands: () => ComposerCommandData[];
  getMentions: () => ComposerMentionData[];
  getSubmitData: () => ComposerPromptSubmitData;
  readSnapshot: () => ComposerPromptEditorSnapshot;
  editor: LexicalEditor | null;
}

export interface ComposerPromptEditorProps {
  value: string;
  cursor: number;
  syncRevision: number;
  forceSyncGeneration?: number;
  disabled: boolean;
  placeholder: string;
  className?: string | undefined;
  hotkeyTargetRef?: RefObject<HTMLDivElement | null>;
  caretAnchorRef?: RefObject<HTMLSpanElement | null>;
  commandMenuAnchorExpandedOffset?: number | null;
  commandMenuOpen?: boolean;
  onMeasuredMultilineChange?: (multiline: boolean) => void;
  onChange: (
    nextValue: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
  ) => void;
  onCommandKeyDown?: (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Escape" | "Tab",
    event: KeyboardEvent,
  ) => boolean;
  onPaste: ClipboardEventHandler<HTMLElement>;
}

export type ComposerMentionPayload = {
  path: string;
  label: string | null;
  lineStart: number | null;
  lineEnd: number | null;
};

export type ComposerCommandPayload = ComposerCommandData;

export type ComposerSkillPayload = {
  name: string;
  label: string;
  description: string | null;
  path: string | null;
};

export type ComposerInlineTokenPayload = {
  label: string;
  sourceUri: string;
  markdown: string;
};

export type ComposerDocSegment =
  | { type: "text"; text: string }
  | { type: "linebreak" }
  | { type: "mention"; payload: ComposerMentionPayload }
  | { type: "command"; payload: ComposerCommandPayload }
  | { type: "skill"; payload: ComposerSkillPayload }
  | { type: "inline-token"; payload: ComposerInlineTokenPayload };

export type SerializedComposerMentionNode = SerializedLexicalNode &
  ComposerMentionPayload & {
    text: string;
  };

export type SerializedComposerCommandNode = SerializedLexicalNode &
  Omit<ComposerCommandPayload, "type"> & {
    commandType: string | null;
    text: string;
  };

export type SerializedComposerSkillNode = SerializedLexicalNode &
  ComposerSkillPayload & {
    text: string;
  };

export type SerializedComposerInlineTokenNode = SerializedLexicalNode &
  ComposerInlineTokenPayload & {
    text: string;
  };

export type LexicalSelectionPoint = {
  key: NodeKey;
  offset: number;
  type: "text" | "element";
};

export type SurroundSelectionSnapshot = {
  start: number;
  end: number;
  value: string;
};
