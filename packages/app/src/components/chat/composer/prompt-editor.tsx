import Link from "@tiptap/extension-link";
import Mention from "@tiptap/extension-mention";
import { Placeholder } from "@tiptap/extensions";
import { PluginKey, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import {
  EditorContent,
  Node as TiptapNode,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  useEditor,
  type Editor,
  type JSONContent,
  type NodeViewProps,
} from "@tiptap/react";
import { type ServerProviderSkill } from "@multi/contracts";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ClipboardEventHandler,
  type ReactElement,
  type RefObject,
} from "react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  expandCollapsedComposerCursor,
  isCollapsedCursorAdjacentToInlineToken,
} from "~/composer-logic";
import {
  selectionTouchesMentionBoundary,
  splitPromptIntoComposerSegments,
} from "~/composer-editor-mentions";
import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  type TerminalContextDraft,
} from "~/lib/terminal-context";
import { cn } from "~/lib/utils";
import { basenameOfPath, getVscodeIconUrlForEntry, inferEntryKindFromPath } from "~/vscode-icons";
import { formatProviderSkillDisplayName } from "~/provider-skill-presentation";
import { parseComposerPromptDoc, type ComposerPromptDoc } from "~/composer-prompt-doc";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@multi/ui/tooltip";
import { ComposerPendingTerminalContextChip } from "./pending-terminal-contexts";
import {
  ComposerInlineChip,
  ComposerInlineChipIcon,
  ComposerInlineChipLabel,
} from "../../composer-inline-chip";

const SURROUND_SYMBOLS: [string, string][] = [
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["'", "'"],
  ['"', '"'],
  ["“", "”"],
  ["`", "`"],
  ["<", ">"],
  ["«", "»"],
  ["*", "*"],
  ["_", "_"],
];
const SURROUND_SYMBOLS_MAP = new Map<string, string>(SURROUND_SYMBOLS);
const COMPOSER_ATOM_NODE_NAMES = new Set([
  "mentionNode",
  "commandNode",
  "skillNode",
  "inlineTokenNode",
  "terminalContextNode",
]);
const COMPOSER_MENTION_PLUGIN_KEY = new PluginKey("multi-composer-mention");
const EMPTY_DOC = Object.freeze({
  type: "doc",
  content: [{ type: "paragraph" }],
}) satisfies ComposerPromptDoc;

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
  doc: ComposerPromptDoc;
  commands: ComposerCommandData[];
  mentions: ComposerMentionData[];
}

export interface ComposerPromptEditorSnapshot {
  value: string;
  cursor: number;
  expandedCursor: number;
  terminalContextIds: string[];
  doc: ComposerPromptDoc;
}

export interface ComposerPromptEditorHandle {
  focus: () => void;
  blur: () => void;
  clear: () => void;
  focusAt: (cursor: number) => void;
  focusAtEnd: () => void;
  insertText: (text: string) => void;
  replaceRangeWithCommand: (
    rangeStart: number,
    rangeEnd: number,
    command: ComposerCommandData,
  ) => boolean;
  getText: () => string;
  getCommands: () => ComposerCommandData[];
  getMentions: () => ComposerMentionData[];
  getSubmitData: () => ComposerPromptSubmitData;
  readSnapshot: () => ComposerPromptEditorSnapshot;
  editor: Editor | null;
}

interface ComposerPromptEditorProps {
  value: string;
  cursor: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  doc?: ComposerPromptDoc | null;
  skills: ReadonlyArray<ServerProviderSkill>;
  disabled: boolean;
  placeholder: string;
  className?: string;
  hotkeyTargetRef?: RefObject<HTMLDivElement | null>;
  onRemoveTerminalContext: (contextId: string) => void;
  onMeasuredMultilineChange?: (multiline: boolean) => void;
  onChange: (
    nextValue: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
    terminalContextIds: string[],
    doc: ComposerPromptDoc,
  ) => void;
  onCommandKeyDown?: (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Escape" | "Tab",
    event: KeyboardEvent,
  ) => boolean;
  onPaste: ClipboardEventHandler<HTMLElement>;
}

type ComposerSkillMetadata = {
  label: string;
  description: string | null;
};

type SurroundSelectionSnapshot = {
  from: number;
  to: number;
  expandedStart: number;
  expandedEnd: number;
  value: string;
};

function resolvedThemeFromDocument(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function resolveSkillDescription(
  skill: Pick<ServerProviderSkill, "shortDescription" | "description">,
): string | null {
  const shortDescription = skill.shortDescription?.trim();
  if (shortDescription) {
    return shortDescription;
  }
  const description = skill.description?.trim();
  return description || null;
}

function skillMetadataByName(
  skills: ReadonlyArray<ServerProviderSkill>,
): ReadonlyMap<string, ComposerSkillMetadata> {
  return new Map(
    skills.map((skill) => [
      skill.name,
      {
        label: formatProviderSkillDisplayName(skill),
        description: resolveSkillDescription(skill),
      },
    ]),
  );
}

function terminalContextSignature(contexts: ReadonlyArray<TerminalContextDraft>): string {
  return contexts
    .map((context) =>
      [
        context.id,
        context.threadId,
        context.terminalId,
        context.terminalLabel,
        context.lineStart,
        context.lineEnd,
        context.createdAt,
        context.text,
      ].join("\u001f"),
    )
    .join("\u001e");
}

function skillSignature(skills: ReadonlyArray<ServerProviderSkill>): string {
  return skills
    .map((skill) =>
      [
        skill.name,
        skill.displayName ?? "",
        skill.shortDescription ?? "",
        skill.description ?? "",
        skill.path,
        skill.scope ?? "",
        skill.enabled ? "1" : "0",
      ].join("\u001f"),
    )
    .join("\u001e");
}

function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function stringAttr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableStringAttr(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumberAttr(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mentionText(attrs: Record<string, unknown>): string {
  const path = stringAttr(attrs.path);
  return path ? `@${path}` : "@";
}

function commandText(attrs: Record<string, unknown>): string {
  const name = stringAttr(attrs.name);
  return name ? `/${name}` : "/";
}

function skillText(attrs: Record<string, unknown>): string {
  const skillName = stringAttr(attrs.skillName);
  const skillPath = nullableStringAttr(attrs.skillPath);
  if (!skillName) return "$";
  return skillPath ? `[$${skillName}](${skillPath})` : `$${skillName}`;
}

function inlineTokenText(attrs: Record<string, unknown>): string {
  return stringAttr(attrs.markdown);
}

function terminalContextText(): string {
  return INLINE_TERMINAL_CONTEXT_PLACEHOLDER;
}

function expandedLeafText(node: ProseMirrorNode): string {
  switch (node.type.name) {
    case "hardBreak":
      return "\n";
    case "mentionNode":
      return mentionText(node.attrs);
    case "commandNode":
      return commandText(node.attrs);
    case "skillNode":
      return skillText(node.attrs);
    case "inlineTokenNode":
      return inlineTokenText(node.attrs);
    case "terminalContextNode":
      return terminalContextText();
    default:
      return "";
  }
}

function collapsedLeafText(node: ProseMirrorNode): string {
  if (node.type.name === "hardBreak") {
    return "\n";
  }
  return COMPOSER_ATOM_NODE_NAMES.has(node.type.name) ? "\ufffc" : "";
}

function textBetween(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  mode: "expanded" | "collapsed",
): string {
  const safeFrom = Math.max(0, Math.min(doc.content.size, from));
  const safeTo = Math.max(safeFrom, Math.min(doc.content.size, to));
  return doc.textBetween(
    safeFrom,
    safeTo,
    "\n",
    mode === "expanded" ? expandedLeafText : collapsedLeafText,
  );
}

function promptTextFromDoc(doc: ProseMirrorNode): string {
  return textBetween(doc, 0, doc.content.size, "expanded");
}

function textToPosition(
  doc: ProseMirrorNode,
  targetOffset: number,
  mode: "expanded" | "collapsed",
): number {
  const fullLength = textBetween(doc, 0, doc.content.size, mode).length;
  const boundedTarget = Math.max(0, Math.min(fullLength, Math.floor(targetOffset)));
  const maxPosition = Math.max(1, doc.content.size - 1);
  if (boundedTarget <= 0) return 1;
  if (boundedTarget >= fullLength) return maxPosition;

  let low = 1;
  let high = maxPosition;
  let result = maxPosition;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lengthAtMid = textBetween(doc, 0, mid, mode).length;
    if (lengthAtMid >= boundedTarget) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return result;
}

function setSelectionAtCollapsedOffset(editor: Editor, cursor: number): void {
  const position = textToPosition(editor.state.doc, cursor, "collapsed");
  const selection = TextSelection.near(editor.state.doc.resolve(position), 1);
  editor.view.dispatch(editor.state.tr.setSelection(selection));
}

function appendTextNodes(content: JSONContent[], text: string): void {
  const parts = text.split("\n");
  parts.forEach((part, index) => {
    if (index > 0) {
      content.push({ type: "hardBreak" });
    }
    if (part.length > 0) {
      content.push({ type: "text", text: part });
    }
  });
}

function promptToTiptapDoc(
  prompt: string,
  terminalContexts: ReadonlyArray<TerminalContextDraft>,
  skillMetadata: ReadonlyMap<string, ComposerSkillMetadata>,
): ComposerPromptDoc {
  if (!prompt) {
    return EMPTY_DOC as ComposerPromptDoc;
  }

  const content: JSONContent[] = [];
  for (const segment of splitPromptIntoComposerSegments(prompt, terminalContexts)) {
    if (segment.type === "text") {
      appendTextNodes(content, segment.text);
      continue;
    }
    if (segment.type === "mention") {
      content.push({
        type: "mentionNode",
        attrs: {
          path: segment.path,
          label: basenameOfPath(segment.path),
        },
      });
      continue;
    }
    if (segment.type === "skill") {
      const metadata = skillMetadata.get(segment.name);
      const attrs: Record<string, unknown> = {
        skillName: segment.name,
        skillLabel: metadata?.label ?? formatProviderSkillDisplayName({ name: segment.name }),
      };
      if (metadata?.description) attrs.skillDescription = metadata.description;
      if (segment.path) attrs.skillPath = segment.path;
      content.push({ type: "skillNode", attrs });
      continue;
    }
    if (segment.type === "inline-token") {
      content.push({
        type: "inlineTokenNode",
        attrs: {
          label: segment.label,
          sourceUri: segment.sourceUri,
          markdown: segment.markdown,
        },
      });
      continue;
    }
    if (segment.type === "terminal-context" && segment.context) {
      content.push({
        type: "terminalContextNode",
        attrs: { context: segment.context },
      });
    }
  }

  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        ...(content.length > 0 ? { content } : {}),
      },
    ],
  };
}

function collectTerminalContextIds(doc: ProseMirrorNode): string[] {
  const ids: string[] = [];
  doc.descendants((node) => {
    if (node.type.name !== "terminalContextNode") {
      return true;
    }
    const context = node.attrs.context;
    if (context && typeof context === "object" && "id" in context) {
      const id = context.id;
      if (typeof id === "string") {
        ids.push(id);
      }
    }
    return false;
  });
  return ids;
}

function collectCommands(doc: ProseMirrorNode): ComposerCommandData[] {
  const commands: ComposerCommandData[] = [];
  doc.descendants((node) => {
    if (node.type.name !== "commandNode") {
      return true;
    }
    commands.push({
      id: stringAttr(node.attrs.id),
      name: stringAttr(node.attrs.name),
      content: nullableStringAttr(node.attrs.content),
      type: nullableStringAttr(node.attrs.type),
    });
    return false;
  });
  return commands;
}

function collectMentions(doc: ProseMirrorNode): ComposerMentionData[] {
  const mentions: ComposerMentionData[] = [];
  doc.descendants((node) => {
    if (node.type.name !== "mentionNode") {
      return true;
    }
    mentions.push({
      path: stringAttr(node.attrs.path),
      label: nullableStringAttr(node.attrs.label),
      lineStart: nullableNumberAttr(node.attrs.lineStart),
      lineEnd: nullableNumberAttr(node.attrs.lineEnd),
    });
    return false;
  });
  return mentions;
}

function readSnapshotFromEditor(editor: Editor): ComposerPromptEditorSnapshot {
  const doc = editor.state.doc;
  const selection = editor.state.selection;
  const head =
    "head" in selection && typeof selection.head === "number" ? selection.head : selection.to;
  const value = promptTextFromDoc(doc);
  const cursor = textBetween(doc, 0, head, "collapsed").length;
  const expandedCursor = textBetween(doc, 0, head, "expanded").length;
  return {
    value,
    cursor,
    expandedCursor,
    terminalContextIds: collectTerminalContextIds(doc),
    doc: editor.getJSON() as ComposerPromptDoc,
  };
}

function snapshotsEqual(
  left: Omit<ComposerPromptEditorSnapshot, "doc">,
  right: Omit<ComposerPromptEditorSnapshot, "doc">,
): boolean {
  return (
    left.value === right.value &&
    left.cursor === right.cursor &&
    left.expandedCursor === right.expandedCursor &&
    left.terminalContextIds.length === right.terminalContextIds.length &&
    left.terminalContextIds.every((id, index) => id === right.terminalContextIds[index])
  );
}

function emitMeasuredMultiline(
  editor: Editor,
  callback: ((multiline: boolean) => void) | undefined,
): void {
  if (!callback) return;
  const dom = editor.view.dom;
  const computed = window.getComputedStyle(dom);
  const lineHeight = Number.parseFloat(computed.lineHeight);
  const fallbackLineHeight = Number.parseFloat(computed.fontSize) * 1.5;
  const resolvedLineHeight = Number.isFinite(lineHeight) ? lineHeight : fallbackLineHeight;
  const range = document.createRange();
  range.selectNodeContents(dom);
  const contentHeight = range.getBoundingClientRect().height;
  range.detach();
  const value = promptTextFromDoc(editor.state.doc);
  callback(
    value.includes("\n") ||
      dom.scrollHeight > resolvedLineHeight * 1.5 ||
      contentHeight > resolvedLineHeight * 1.5,
  );
}

function selectionContainsComposerAtom(editor: Editor, from: number, to: number): boolean {
  let containsAtom = false;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (COMPOSER_ATOM_NODE_NAMES.has(node.type.name)) {
      containsAtom = true;
      return false;
    }
    return true;
  });
  return containsAtom;
}

function syncEditorSelectionFromDom(editor: Editor): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  if (!anchorNode || !focusNode) return;
  if (!editor.view.dom.contains(anchorNode) || !editor.view.dom.contains(focusNode)) return;

  try {
    const anchor = editor.view.posAtDOM(anchorNode, selection.anchorOffset);
    const head = editor.view.posAtDOM(focusNode, selection.focusOffset);
    if (anchor === editor.state.selection.anchor && head === editor.state.selection.head) {
      return;
    }
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, anchor, head)),
    );
  } catch {
    // ProseMirror may reject DOM points inside atom node views. In that case the
    // current editor state is still the safest source of truth.
  }
}

function captureSurroundSelection(editor: Editor): SurroundSelectionSnapshot | null {
  syncEditorSelectionFromDom(editor);
  const selection = editor.state.selection;
  if (selection.empty) return null;
  const from = Math.min(selection.from, selection.to);
  const to = Math.max(selection.from, selection.to);
  if (selectionContainsComposerAtom(editor, from, to)) {
    return null;
  }
  const value = promptTextFromDoc(editor.state.doc);
  const expandedStart = textBetween(editor.state.doc, 0, from, "expanded").length;
  const expandedEnd = textBetween(editor.state.doc, 0, to, "expanded").length;
  if (selectionTouchesMentionBoundary(value, expandedStart, expandedEnd)) {
    return null;
  }
  return { from, to, expandedStart, expandedEnd, value };
}

function applySurroundInput(
  editor: Editor,
  snapshot: SurroundSelectionSnapshot,
  open: string,
  close: string,
): boolean {
  const selection = editor.state.selection;
  if (
    selection.empty ||
    Math.min(selection.from, selection.to) !== snapshot.from ||
    Math.max(selection.from, selection.to) !== snapshot.to
  ) {
    return false;
  }

  const tr = editor.state.tr;
  tr.insertText(open, snapshot.from, snapshot.from);
  tr.insertText(close, snapshot.to + open.length, snapshot.to + open.length);
  tr.setSelection(
    TextSelection.create(tr.doc, snapshot.from + open.length, snapshot.to + open.length),
  );
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

function ComposerMentionNodeView(props: NodeViewProps): ReactElement {
  const path = stringAttr(props.node.attrs.path);
  const label = nullableStringAttr(props.node.attrs.label) ?? basenameOfPath(path);
  const lineStart = nullableNumberAttr(props.node.attrs.lineStart);
  const lineEnd = nullableNumberAttr(props.node.attrs.lineEnd);
  const theme = resolvedThemeFromDocument();
  const chip = (
    <ComposerInlineChip
      className="ui-pill ui-prompt-input-mention-chip"
      contentEditable={false}
      data-read-only-mention=""
      data-type="mentionNode"
      spellCheck={false}
    >
      <img
        alt=""
        aria-hidden="true"
        className="size-3.5 shrink-0 opacity-85"
        loading="lazy"
        src={getVscodeIconUrlForEntry(path, inferEntryKindFromPath(path), theme)}
      />
      <ComposerInlineChipLabel>{label}</ComposerInlineChipLabel>
      {lineStart !== null && lineEnd !== null ? (
        <span className="text-multi-fg-tertiary">
          {lineStart === lineEnd ? `:${lineStart}` : `:${lineStart}-${lineEnd}`}
        </span>
      ) : null}
    </ComposerInlineChip>
  );

  return (
    <NodeViewWrapper as="span" className="inline-flex align-middle">
      <Tooltip>
        <TooltipTrigger render={chip} />
        <TooltipPopup
          side="top"
          className="max-w-[30rem] whitespace-normal text-xs/4 wrap-anywhere"
        >
          {path}
        </TooltipPopup>
      </Tooltip>
    </NodeViewWrapper>
  );
}

function ComposerCommandNodeView(props: NodeViewProps): ReactElement {
  const name = stringAttr(props.node.attrs.name);
  const content = nullableStringAttr(props.node.attrs.content);
  const label = name ? `/${name}` : "/";
  const chip = (
    <ComposerInlineChip
      className="ui-prompt-input-command-chip"
      contentEditable={false}
      data-type="commandNode"
      spellCheck={false}
    >
      <button
        type="button"
        tabIndex={-1}
        className="ui-prompt-input-command-chip__label--clickable truncate text-left"
      >
        {label}
      </button>
    </ComposerInlineChip>
  );

  return (
    <NodeViewWrapper as="span" className="inline-flex align-middle">
      {content ? (
        <Tooltip>
          <TooltipTrigger render={chip} />
          <TooltipPopup side="top" className="max-w-[30rem] whitespace-normal text-xs/4">
            {content}
          </TooltipPopup>
        </Tooltip>
      ) : (
        chip
      )}
    </NodeViewWrapper>
  );
}

function SkillGlyph(): ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function ComposerSkillNodeView(props: NodeViewProps): ReactElement {
  const label =
    nullableStringAttr(props.node.attrs.skillLabel) ??
    formatProviderSkillDisplayName({ name: stringAttr(props.node.attrs.skillName) });
  const description = nullableStringAttr(props.node.attrs.skillDescription);
  const chip = (
    <ComposerInlineChip
      tone="object"
      contentEditable={false}
      data-composer-skill-chip="true"
      spellCheck={false}
    >
      <ComposerInlineChipIcon aria-hidden="true">
        <SkillGlyph />
      </ComposerInlineChipIcon>
      <ComposerInlineChipLabel>{label}</ComposerInlineChipLabel>
    </ComposerInlineChip>
  );

  return (
    <NodeViewWrapper as="span" className="inline-flex align-middle">
      {description ? (
        <Tooltip>
          <TooltipTrigger render={chip} />
          <TooltipPopup side="top" className="max-w-[30rem] whitespace-normal text-xs/4">
            {description}
          </TooltipPopup>
        </Tooltip>
      ) : (
        chip
      )}
    </NodeViewWrapper>
  );
}

function ComposerInlineTokenNodeView(props: NodeViewProps): ReactElement {
  const label =
    nullableStringAttr(props.node.attrs.label) ??
    nullableStringAttr(props.node.attrs.sourceUri) ??
    "";
  const sourceUri = nullableStringAttr(props.node.attrs.sourceUri);
  const chip = (
    <ComposerInlineChip
      contentEditable={false}
      data-composer-inline-token-chip="true"
      spellCheck={false}
    >
      <ComposerInlineChipLabel>{label}</ComposerInlineChipLabel>
    </ComposerInlineChip>
  );

  return (
    <NodeViewWrapper as="span" className="inline-flex align-middle">
      {sourceUri ? (
        <Tooltip>
          <TooltipTrigger render={chip} />
          <TooltipPopup side="top" className="max-w-[30rem] whitespace-normal text-xs/4">
            {sourceUri}
          </TooltipPopup>
        </Tooltip>
      ) : (
        chip
      )}
    </NodeViewWrapper>
  );
}

function ComposerTerminalContextNodeView(props: NodeViewProps): ReactElement {
  const context = props.node.attrs.context as TerminalContextDraft;
  return (
    <NodeViewWrapper as="span" className="inline-flex align-middle">
      <ComposerPendingTerminalContextChip context={context} />
    </NodeViewWrapper>
  );
}

const ComposerMentionExtension = Mention.extend({
  name: "mentionNode",

  addAttributes() {
    return {
      path: { default: "" },
      label: { default: null },
      lineStart: { default: null },
      lineEnd: { default: null },
    };
  },

  renderText({ node }) {
    return mentionText(node.attrs);
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "mentionNode",
        "data-read-only-mention": "",
        class: "ui-pill ui-prompt-input-mention-chip",
      }),
      mentionText(node.attrs),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ComposerMentionNodeView);
  },
}).configure({
  HTMLAttributes: {
    class: "ui-pill ui-prompt-input-mention-chip",
  },
  renderText: ({ node }) => mentionText(node.attrs),
  renderHTML: ({ node }) => [
    "span",
    {
      "data-type": "mentionNode",
      "data-read-only-mention": "",
      class: "ui-pill ui-prompt-input-mention-chip",
    },
    mentionText(node.attrs),
  ],
  suggestion: {
    char: "@",
    pluginKey: COMPOSER_MENTION_PLUGIN_KEY,
    allowSpaces: true,
    allowedPrefixes: null,
    allow: () => false,
    items: () => [],
  },
});

const ComposerCommandExtension = TiptapNode.create({
  name: "commandNode",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: { default: "" },
      name: { default: "" },
      content: { default: null },
      type: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="commandNode"]' }];
  },

  renderText({ node }) {
    return commandText(node.attrs);
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "commandNode",
        class: "ui-prompt-input-command-chip",
      }),
      commandText(node.attrs),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ComposerCommandNodeView);
  },
});

const ComposerSkillExtension = TiptapNode.create({
  name: "skillNode",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      skillName: { default: "" },
      skillLabel: { default: "" },
      skillDescription: { default: null },
      skillPath: { default: null },
    };
  },

  renderText({ node }) {
    return skillText(node.attrs);
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "skillNode",
        class: "ui-pill ui-prompt-input-mention-chip",
      }),
      skillText(node.attrs),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ComposerSkillNodeView);
  },
});

const ComposerInlineTokenExtension = TiptapNode.create({
  name: "inlineTokenNode",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      label: { default: "" },
      sourceUri: { default: "" },
      markdown: { default: "" },
    };
  },

  renderText({ node }) {
    return inlineTokenText(node.attrs);
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "inlineTokenNode",
        class: "ui-pill ui-prompt-input-mention-chip",
      }),
      inlineTokenText(node.attrs),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ComposerInlineTokenNodeView);
  },
});

const ComposerTerminalContextExtension = TiptapNode.create({
  name: "terminalContextNode",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      context: { default: null },
    };
  },

  renderText() {
    return terminalContextText();
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "terminalContextNode",
        class: "ui-pill ui-prompt-input-mention-chip",
      }),
      terminalContextText(),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ComposerTerminalContextNodeView);
  },
});

function createComposerExtensions(placeholderRef: { current: string }) {
  return [
    StarterKit.configure({
      heading: false,
      link: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      blockquote: false,
      codeBlock: false,
      horizontalRule: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
    }),
    Link.configure({
      openOnClick: false,
      enableClickSelection: false,
      linkOnPaste: false,
      autolink: false,
      defaultProtocol: "https",
      HTMLAttributes: {
        class: "ui-prompt-input-link",
        rel: "noreferrer",
        target: "_blank",
      },
      isAllowedUri: (url) => isSafeHttpUrl(url),
      shouldAutoLink: () => false,
    }),
    Placeholder.configure({
      placeholder: () => placeholderRef.current,
    }),
    ComposerCommandExtension,
    ComposerMentionExtension,
    ComposerSkillExtension,
    ComposerInlineTokenExtension,
    ComposerTerminalContextExtension,
  ];
}

export const ComposerPromptEditor = forwardRef<
  ComposerPromptEditorHandle,
  ComposerPromptEditorProps
>(function ComposerPromptEditor(
  {
    value,
    cursor,
    terminalContexts,
    doc,
    skills,
    disabled,
    placeholder,
    className,
    hotkeyTargetRef,
    onRemoveTerminalContext: _onRemoveTerminalContext,
    onMeasuredMultilineChange,
    onChange,
    onCommandKeyDown,
    onPaste,
  },
  ref,
) {
  const onChangeRef = useRef(onChange);
  const onCommandKeyDownRef = useRef(onCommandKeyDown);
  const onMeasuredMultilineChangeRef = useRef(onMeasuredMultilineChange);
  const onPasteRef = useRef(onPaste);
  const placeholderRef = useRef(placeholder);
  onMeasuredMultilineChangeRef.current = onMeasuredMultilineChange;
  placeholderRef.current = placeholder;
  const extensionsRef = useRef<ReturnType<typeof createComposerExtensions> | null>(null);
  extensionsRef.current ??= createComposerExtensions(placeholderRef);
  const pendingSurroundSelectionRef = useRef<SurroundSelectionSnapshot | null>(null);
  const isApplyingControlledUpdateRef = useRef(false);
  const skillMetadataRef = useRef(skillMetadataByName(skills));
  const initialDocRef = useRef(
    parseComposerPromptDoc(doc) ??
      promptToTiptapDoc(value, terminalContexts, skillMetadataRef.current),
  );
  const initialCursor = clampCollapsedComposerCursor(value, cursor);
  const initialSnapshotRef = useRef<ComposerPromptEditorSnapshot>({
    value,
    cursor: initialCursor,
    expandedCursor: expandCollapsedComposerCursor(value, initialCursor),
    terminalContextIds: terminalContexts.map((context) => context.id),
    doc: initialDocRef.current,
  });
  const snapshotRef = useRef(initialSnapshotRef.current);
  const terminalContextsSignature = terminalContextSignature(terminalContexts);
  const terminalContextsSignatureRef = useRef(terminalContextsSignature);
  const skillsSignature = skillSignature(skills);
  const skillsSignatureRef = useRef(skillsSignature);
  const parsedPromptDoc = parseComposerPromptDoc(doc);
  const promptDocSignature = parsedPromptDoc ? JSON.stringify(parsedPromptDoc) : "";
  const promptDocSignatureRef = useRef(promptDocSignature);

  const emitSnapshotRef = useRef<(editor: Editor) => void>(() => {});
  const keyDownHandlerRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const beforeInputHandlerRef = useRef<(event: InputEvent) => boolean>(() => false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onCommandKeyDownRef.current = onCommandKeyDown;
  }, [onCommandKeyDown]);

  useEffect(() => {
    onPasteRef.current = onPaste;
  }, [onPaste]);

  useLayoutEffect(() => {
    skillMetadataRef.current = skillMetadataByName(skills);
  }, [skills]);

  const editorClassName = cn(
    "composer-prompt-editor-input ui-prompt-input-editor__input block w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent p-(--prompt-input-editor-padding) text-conversation/[1.5] text-foreground outline-hidden min-h-(--prompt-input-editor-min-height) max-h-(--prompt-input-editor-max-height)",
    className,
  );

  const editor = useEditor(
    {
      extensions: extensionsRef.current,
      content: initialDocRef.current as JSONContent,
      editable: !disabled,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: editorClassName,
          "data-testid": "composer-editor",
          tabindex: "-1",
        },
        handleKeyDown: (_view, event) => keyDownHandlerRef.current(event),
        handleDOMEvents: {
          beforeinput: (_view, event) => beforeInputHandlerRef.current(event as InputEvent),
          paste: (_view, event) => {
            onPasteRef.current(
              event as unknown as Parameters<ClipboardEventHandler<HTMLElement>>[0],
            );
            return event.defaultPrevented;
          },
        },
      },
      onUpdate: ({ editor: nextEditor }) => {
        emitSnapshotRef.current(nextEditor);
      },
      onSelectionUpdate: ({ editor: nextEditor }) => {
        emitSnapshotRef.current(nextEditor);
      },
    },
    [],
  );

  const readSnapshot = useCallback((): ComposerPromptEditorSnapshot => {
    if (!editor) {
      return snapshotRef.current;
    }
    const nextSnapshot = readSnapshotFromEditor(editor);
    snapshotRef.current = nextSnapshot;
    return nextSnapshot;
  }, [editor]);

  emitSnapshotRef.current = (nextEditor: Editor) => {
    if (isApplyingControlledUpdateRef.current) {
      return;
    }
    const nextSnapshot = readSnapshotFromEditor(nextEditor);
    const previous = snapshotRef.current;
    snapshotRef.current = nextSnapshot;
    if (snapshotsEqual(previous, nextSnapshot)) {
      return;
    }
    const cursorAdjacentToMention =
      isCollapsedCursorAdjacentToInlineToken(nextSnapshot.value, nextSnapshot.cursor, "left") ||
      isCollapsedCursorAdjacentToInlineToken(nextSnapshot.value, nextSnapshot.cursor, "right");
    onChangeRef.current(
      nextSnapshot.value,
      nextSnapshot.cursor,
      nextSnapshot.expandedCursor,
      cursorAdjacentToMention,
      nextSnapshot.terminalContextIds,
      nextSnapshot.doc,
    );
    emitMeasuredMultiline(nextEditor, onMeasuredMultilineChangeRef.current);
  };

  keyDownHandlerRef.current = (event: KeyboardEvent) => {
    if (!editor) return false;
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Escape" ||
      event.key === "Enter" ||
      event.key === "Tab"
    ) {
      const handled = onCommandKeyDownRef.current?.(event.key, event) ?? false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
        pendingSurroundSelectionRef.current = null;
        return true;
      }
    }

    if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey) {
      pendingSurroundSelectionRef.current = null;
      return false;
    }
    pendingSurroundSelectionRef.current = captureSurroundSelection(editor);
    return false;
  };

  beforeInputHandlerRef.current = (event: InputEvent) => {
    if (!editor) return false;
    const pendingSelection = pendingSurroundSelectionRef.current;
    if (!pendingSelection) {
      return false;
    }
    if (event.inputType === "insertCompositionText") {
      return false;
    }
    if (event.inputType !== "insertText" || typeof event.data !== "string") {
      pendingSurroundSelectionRef.current = null;
      return false;
    }
    const close = SURROUND_SYMBOLS_MAP.get(event.data);
    if (!close) {
      pendingSurroundSelectionRef.current = null;
      return false;
    }
    if (!applySurroundInput(editor, pendingSelection, event.data, close)) {
      pendingSurroundSelectionRef.current = null;
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    pendingSurroundSelectionRef.current = null;
    return true;
  };

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useLayoutEffect(() => {
    if (!editor) return;
    const normalizedCursor = clampCollapsedComposerCursor(value, cursor);
    const previousSnapshot = snapshotRef.current;
    const contextsChanged = terminalContextsSignatureRef.current !== terminalContextsSignature;
    const skillsChanged = skillsSignatureRef.current !== skillsSignature;
    const docChanged = promptDocSignatureRef.current !== promptDocSignature;
    if (
      previousSnapshot.value === value &&
      previousSnapshot.cursor === normalizedCursor &&
      !contextsChanged &&
      !skillsChanged &&
      !docChanged
    ) {
      return;
    }

    const nextDoc =
      parsedPromptDoc ?? promptToTiptapDoc(value, terminalContexts, skillMetadataRef.current);
    snapshotRef.current = {
      value,
      cursor: normalizedCursor,
      expandedCursor: expandCollapsedComposerCursor(value, normalizedCursor),
      terminalContextIds: terminalContexts.map((context) => context.id),
      doc: nextDoc,
    };
    terminalContextsSignatureRef.current = terminalContextsSignature;
    skillsSignatureRef.current = skillsSignature;
    promptDocSignatureRef.current = promptDocSignature;

    const rootElement = editor.view.dom;
    const isFocused = document.activeElement === rootElement;
    if (
      previousSnapshot.value === value &&
      !contextsChanged &&
      !skillsChanged &&
      !docChanged &&
      !isFocused
    ) {
      return;
    }

    isApplyingControlledUpdateRef.current = true;
    const shouldRewriteEditorState =
      previousSnapshot.value !== value || contextsChanged || skillsChanged || docChanged;
    if (shouldRewriteEditorState) {
      editor.commands.setContent(nextDoc as JSONContent, { emitUpdate: false });
    }
    if (shouldRewriteEditorState || isFocused) {
      setSelectionAtCollapsedOffset(editor, normalizedCursor);
    }
    queueMicrotask(() => {
      isApplyingControlledUpdateRef.current = false;
      emitMeasuredMultiline(editor, onMeasuredMultilineChangeRef.current);
    });
  }, [
    cursor,
    editor,
    parsedPromptDoc,
    promptDocSignature,
    skillsSignature,
    terminalContexts,
    terminalContextsSignature,
    value,
  ]);

  useLayoutEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    emitMeasuredMultiline(editor, onMeasuredMultilineChangeRef.current);
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      emitMeasuredMultiline(editor, onMeasuredMultilineChangeRef.current);
    });
    observer.observe(dom);
    return () => {
      observer.disconnect();
    };
  }, [editor]);

  const focusAt = useCallback(
    (nextCursor: number) => {
      if (!editor) return;
      const boundedCursor = clampCollapsedComposerCursor(snapshotRef.current.value, nextCursor);
      editor.commands.focus();
      setSelectionAtCollapsedOffset(editor, boundedCursor);
      const nextSnapshot = readSnapshotFromEditor(editor);
      snapshotRef.current = nextSnapshot;
      onChangeRef.current(
        nextSnapshot.value,
        nextSnapshot.cursor,
        nextSnapshot.expandedCursor,
        false,
        nextSnapshot.terminalContextIds,
        nextSnapshot.doc,
      );
    },
    [editor],
  );

  const insertText = useCallback(
    (text: string) => {
      if (!editor || !text) return;
      editor.chain().focus().insertContent(text).run();
    },
    [editor],
  );

  const replaceRangeWithCommand = useCallback(
    (rangeStart: number, rangeEnd: number, command: ComposerCommandData): boolean => {
      if (!editor) return false;
      const from = textToPosition(editor.state.doc, rangeStart, "expanded");
      const to = textToPosition(editor.state.doc, rangeEnd, "expanded");
      const safeFrom = Math.min(from, to);
      const safeTo = Math.max(from, to);
      const attrs: Record<string, unknown> = {
        id: command.id,
        name: command.name,
      };
      if (command.content) attrs.content = command.content;
      if (command.type) attrs.type = command.type;
      return editor
        .chain()
        .focus()
        .deleteRange({ from: safeFrom, to: safeTo })
        .insertContent([
          { type: "commandNode", attrs },
          { type: "text", text: " " },
        ])
        .run();
    },
    [editor],
  );

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        focusAt(snapshotRef.current.cursor);
      },
      blur: () => {
        editor?.commands.blur();
      },
      clear: () => {
        if (!editor) return;
        editor.commands.setContent(EMPTY_DOC, { emitUpdate: false });
        setSelectionAtCollapsedOffset(editor, 0);
        const nextSnapshot = readSnapshotFromEditor(editor);
        snapshotRef.current = nextSnapshot;
        onChangeRef.current("", 0, 0, false, [], EMPTY_DOC);
      },
      focusAt,
      focusAtEnd: () => {
        focusAt(
          collapseExpandedComposerCursor(
            snapshotRef.current.value,
            snapshotRef.current.value.length,
          ),
        );
      },
      insertText,
      replaceRangeWithCommand,
      getText: () => readSnapshot().value,
      getCommands: () => (editor ? collectCommands(editor.state.doc) : []),
      getMentions: () => (editor ? collectMentions(editor.state.doc) : []),
      getSubmitData: () => {
        const snapshot = readSnapshot();
        return {
          text: snapshot.value,
          doc: snapshot.doc,
          commands: editor ? collectCommands(editor.state.doc) : [],
          mentions: editor ? collectMentions(editor.state.doc) : [],
        };
      },
      readSnapshot,
      editor,
    }),
    [editor, focusAt, insertText, readSnapshot, replaceRangeWithCommand],
  );

  return (
    <div ref={hotkeyTargetRef} className="composer-prompt-editor relative">
      <EditorContent editor={editor} />
    </div>
  );
});
