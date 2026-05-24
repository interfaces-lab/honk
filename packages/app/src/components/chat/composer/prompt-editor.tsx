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
import { IconBuildingBlocks, type CentralIconBaseProps } from "central-icons";
import type { ComponentType } from "react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
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
} from "./prompt-triggers";
import {
  selectionTouchesMentionBoundary,
  splitPromptIntoComposerSegments,
} from "./prompt-segments";
import { cn } from "~/lib/utils";
import {
  basenameOfPath,
  getVscodeIconUrlForEntry,
  inferEntryKindFromPath,
} from "../shared/vscode-entry-icons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@multi/ui/tooltip";
import { formatProviderSkillDisplayName } from "./provider-skills";
import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import { cva } from "class-variance-authority";
import { useMountEffect } from "~/hooks/use-mount-effect";

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
]);
const COMPOSER_MENTION_PLUGIN_KEY = new PluginKey("composer-mention");
const EMPTY_DOC = Object.freeze({
  type: "doc",
  content: [{ type: "paragraph" }],
}) satisfies PromptEditorDoc;

type PromptEditorDoc = JSONContent & { type: "doc" };

export interface ComposerCommandData {
  id: string;
  name: string;
  content: string | null;
  type: string | null;
}

export interface ComposerSkillData {
  name: string;
  label: string;
  description: string | null;
  path: string | null;
}

export interface ComposerMentionData {
  path: string;
  label: string | null;
  lineStart: number | null;
  lineEnd: number | null;
}

export interface ComposerPromptSubmitData {
  text: string;
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
  replaceRangeWithCommand: (
    rangeStart: number,
    rangeEnd: number,
    command: ComposerCommandData,
  ) => boolean;
  replaceRangeWithSkill: (
    rangeStart: number,
    rangeEnd: number,
    skill: ComposerSkillData,
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
  skills: ReadonlyArray<ServerProviderSkill>;
  disabled: boolean;
  placeholder: string;
  className?: string | undefined;
  hotkeyTargetRef?: RefObject<HTMLDivElement | null>;
  caretAnchorRef?: RefObject<HTMLSpanElement | null>;
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
  skillMetadata: ReadonlyMap<string, ComposerSkillMetadata>,
): PromptEditorDoc {
  if (!prompt) {
    return EMPTY_DOC;
  }

  const content: JSONContent[] = [];
  for (const segment of splitPromptIntoComposerSegments(prompt)) {
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
  };
}

function snapshotsEqual(
  left: ComposerPromptEditorSnapshot,
  right: ComposerPromptEditorSnapshot,
): boolean {
  return (
    left.value === right.value &&
    left.cursor === right.cursor &&
    left.expandedCursor === right.expandedCursor
  );
}

const COMPOSER_EDITOR_MULTILINE_PIXEL_THRESHOLD = 24;

function measureComposerEditorMultiline(editor: Editor): boolean {
  const dom = editor.view.dom;
  const value = promptTextFromDoc(editor.state.doc);
  if (value.includes("\n")) {
    return true;
  }
  if (value.trim().length === 0) {
    return false;
  }

  return dom.scrollHeight > COMPOSER_EDITOR_MULTILINE_PIXEL_THRESHOLD;
}

function emitMeasuredMultiline(
  editor: Editor,
  callback: ((multiline: boolean) => void) | undefined,
  measuredMultilineRef: RefObject<boolean>,
): void {
  if (!callback) return;
  const nextMultiline = measureComposerEditorMultiline(editor);
  if (nextMultiline === measuredMultilineRef.current) {
    return;
  }
  measuredMultilineRef.current = nextMultiline;
  callback(nextMultiline);
}

function notifyComposerEditorMultiline(
  callback: ((multiline: boolean) => void) | undefined,
  measuredMultilineRef: RefObject<boolean>,
  nextMultiline: boolean,
): void {
  if (!callback || nextMultiline === measuredMultilineRef.current) {
    return;
  }
  measuredMultilineRef.current = nextMultiline;
  callback(nextMultiline);
}

function usePromptEditorControlledStateSync({
  cursor,
  editor,
  isApplyingControlledUpdateRef,
  measuredMultilineRef,
  onMeasuredMultilineChangeRef,
  skillsSignature,
  skillsSignatureRef,
  skillMetadataRef,
  snapshotRef,
  value,
}: {
  cursor: number;
  editor: Editor | null;
  isApplyingControlledUpdateRef: RefObject<boolean>;
  measuredMultilineRef: RefObject<boolean>;
  onMeasuredMultilineChangeRef: RefObject<ComposerPromptEditorProps["onMeasuredMultilineChange"]>;
  skillsSignature: string;
  skillsSignatureRef: RefObject<string>;
  skillMetadataRef: RefObject<ReadonlyMap<string, ComposerSkillMetadata>>;
  snapshotRef: RefObject<ComposerPromptEditorSnapshot>;
  value: string;
}) {
  useLayoutSyncEffect(() => {
    if (!editor) return;
    const normalizedCursor = clampCollapsedComposerCursor(value, cursor);
    const previousSnapshot = snapshotRef.current;
    const skillsChanged = skillsSignatureRef.current !== skillsSignature;
    if (
      previousSnapshot.value === value &&
      previousSnapshot.cursor === normalizedCursor &&
      !skillsChanged
    ) {
      return;
    }

    const nextDoc = promptToTiptapDoc(value, skillMetadataRef.current);
    snapshotRef.current = {
      value,
      cursor: normalizedCursor,
      expandedCursor: expandCollapsedComposerCursor(value, normalizedCursor),
    };
    skillsSignatureRef.current = skillsSignature;

    const rootElement = editor.view.dom;
    const isFocused = document.activeElement === rootElement;
    if (previousSnapshot.value === value && !skillsChanged && !isFocused) {
      return;
    }

    isApplyingControlledUpdateRef.current = true;
    const shouldRewriteEditorState = previousSnapshot.value !== value || skillsChanged;
    if (shouldRewriteEditorState) {
      editor.commands.setContent(nextDoc, { emitUpdate: false });
    }
    if (shouldRewriteEditorState || previousSnapshot.cursor !== normalizedCursor) {
      setSelectionAtCollapsedOffset(editor, normalizedCursor);
    }
    emitMeasuredMultiline(editor, onMeasuredMultilineChangeRef.current, measuredMultilineRef);
    queueMicrotask(() => {
      isApplyingControlledUpdateRef.current = false;
    });
  }, [cursor, editor, measuredMultilineRef, skillsSignature, value]);
}

function usePromptEditorMultilineMeasurement({
  editor,
  measuredMultilineRef,
  onMeasuredMultilineChangeRef,
}: {
  editor: Editor | null;
  measuredMultilineRef: RefObject<boolean>;
  onMeasuredMultilineChangeRef: RefObject<ComposerPromptEditorProps["onMeasuredMultilineChange"]>;
}) {
  useLayoutSyncEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    emitMeasuredMultiline(editor, onMeasuredMultilineChangeRef.current, measuredMultilineRef);
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      emitMeasuredMultiline(editor, onMeasuredMultilineChangeRef.current, measuredMultilineRef);
    });
    observer.observe(dom);
    return () => {
      observer.disconnect();
    };
  }, [editor]);
}

// Mirrors Cursor's caret-tracked menu anchor: a real 1x1 span whose position is
// rewritten from `coordsAtPos(selection.from)`. Floating UI reads the live DOM
// rect via MutationObserver-driven updates, not React state per keystroke.
function usePromptEditorCaretAnchor({
  commandMenuOpen,
  editor,
  anchorElementRef,
}: {
  commandMenuOpen: boolean;
  editor: Editor | null;
  anchorElementRef: RefObject<HTMLSpanElement | null>;
}) {
  useLayoutSyncEffect(() => {
    if (!editor || !commandMenuOpen) return;
    const anchor = anchorElementRef.current;
    const editorDom = editor.view.dom;
    const anchorRoot =
      anchor?.offsetParent instanceof HTMLElement ? anchor.offsetParent : anchor?.parentElement;
    if (!anchor || !anchorRoot) return;

    let frame: number | null = null;
    const place = () => {
      const pmPos = Math.min(
        Math.max(editor.state.selection.from, 1),
        editor.state.doc.content.size,
      );
      let coords: ReturnType<typeof editor.view.coordsAtPos>;
      try {
        coords = editor.view.coordsAtPos(pmPos);
      } catch {
        coords = editor.view.coordsAtPos(editor.state.selection.head);
      }
      // Cursor top-start placement uses coords.top for side="top".
      const anchorRootRect = anchorRoot.getBoundingClientRect();
      anchor.style.left = `${coords.left - anchorRootRect.left}px`;
      anchor.style.top = `${coords.top - anchorRootRect.top}px`;
      anchor.style.bottom = "auto";
    };
    const schedulePlace = () => {
      place();
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        frame = null;
        place();
      });
    };

    schedulePlace();
    editor.on("transaction", schedulePlace);
    if (typeof ResizeObserver === "undefined") {
      return () => {
        editor.off("transaction", schedulePlace);
        if (frame !== null) {
          window.cancelAnimationFrame(frame);
        }
      };
    }
    const observer = new ResizeObserver(schedulePlace);
    observer.observe(editorDom);
    observer.observe(anchorRoot);
    return () => {
      editor.off("transaction", schedulePlace);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
    };
  }, [anchorElementRef, commandMenuOpen, editor]);
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

const composerPromptChipVariants = cva(
  cn(
    "inline-flex min-w-0 max-w-(--multi-composer-chip-max-width) select-none items-center gap-0.5",
    "bg-transparent px-0 py-0 font-multi font-normal align-middle",
    "-mt-[3px] -ml-px text-(length:--multi-composer-chip-font-size) leading-(--multi-composer-chip-line-height)",
  ),
  {
    variants: {
      kind: {
        mention: "text-(--multi-composer-mention-text)",
        command: "rounded-[2px] text-(--multi-composer-command-text)",
        skill: "rounded-[2px] text-(--multi-composer-command-text)",
        "inline-token": "text-(--multi-composer-mention-text)",
      },
    },
  },
);

const composerPromptChipIconClass = "size-(--multi-composer-chip-icon-size) shrink-0";

function ComposerMentionNodeView(props: NodeViewProps): ReactElement {
  const path = stringAttr(props.node.attrs.path);
  const label = nullableStringAttr(props.node.attrs.label) ?? basenameOfPath(path);
  const lineStart = nullableNumberAttr(props.node.attrs.lineStart);
  const lineEnd = nullableNumberAttr(props.node.attrs.lineEnd);
  const theme = resolvedThemeFromDocument();
  const chip = (
    <span
      className={composerPromptChipVariants({ kind: "mention" })}
      contentEditable={false}
      data-read-only-mention=""
      data-type="mentionNode"
      spellCheck={false}
    >
      <img
        alt=""
        aria-hidden="true"
        className={cn(composerPromptChipIconClass, "opacity-90")}
        loading="lazy"
        src={getVscodeIconUrlForEntry(path, inferEntryKindFromPath(path), theme)}
      />
      <span className="min-w-0 truncate">{label}</span>
      {lineStart !== null && lineEnd !== null ? (
        <span className="shrink-0 text-(length:--multi-composer-chip-line-range-font-size) text-(--multi-composer-mention-line-range-text)">
          {lineStart === lineEnd ? `:${lineStart}` : `:${lineStart}-${lineEnd}`}
        </span>
      ) : null}
    </span>
  );

  return (
    <NodeViewWrapper as="span" className="inline-flex align-middle">
      <Tooltip>
        <TooltipTrigger render={chip} />
        <TooltipPopup side="top" className="max-w-lg whitespace-normal text-xs/4 wrap-anywhere">
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
    <span
      className={composerPromptChipVariants({ kind: "command" })}
      contentEditable={false}
      data-type="commandNode"
      spellCheck={false}
    >
      <button type="button" tabIndex={-1} className="truncate text-left hover:underline">
        {label}
      </button>
    </span>
  );

  return (
    <NodeViewWrapper as="span" className="inline-flex align-middle">
      {content ? (
        <Tooltip>
          <TooltipTrigger render={chip} />
          <TooltipPopup side="top" className="max-w-lg whitespace-normal text-xs/4">
            {content}
          </TooltipPopup>
        </Tooltip>
      ) : (
        chip
      )}
    </NodeViewWrapper>
  );
}

const SkillIcon: ComponentType<CentralIconBaseProps> = IconBuildingBlocks;

function ComposerSkillNodeView(props: NodeViewProps): ReactElement {
  const label =
    nullableStringAttr(props.node.attrs.skillLabel) ??
    formatProviderSkillDisplayName({
      name: stringAttr(props.node.attrs.skillName),
    });
  const description = nullableStringAttr(props.node.attrs.skillDescription);
  const chip = (
    <span
      className={composerPromptChipVariants({ kind: "skill" })}
      contentEditable={false}
      data-composer-skill-chip="true"
      spellCheck={false}
    >
      <span
        aria-hidden="true"
        className={cn(composerPromptChipIconClass, "text-(--multi-composer-command-text)")}
      >
        <SkillIcon className="size-(--multi-composer-chip-icon-size)" />
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );

  return (
    <NodeViewWrapper as="span" className="inline-flex align-middle">
      {description ? (
        <Tooltip>
          <TooltipTrigger render={chip} />
          <TooltipPopup side="top" className="max-w-lg whitespace-normal text-xs/4">
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
    <span
      className={composerPromptChipVariants({ kind: "inline-token" })}
      contentEditable={false}
      data-composer-inline-token-chip="true"
      spellCheck={false}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );

  return (
    <NodeViewWrapper as="span" className="inline-flex align-middle">
      {sourceUri ? (
        <Tooltip>
          <TooltipTrigger render={chip} />
          <TooltipPopup side="top" className="max-w-lg whitespace-normal text-xs/4">
            {sourceUri}
          </TooltipPopup>
        </Tooltip>
      ) : (
        chip
      )}
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
      }),
      mentionText(node.attrs),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ComposerMentionNodeView);
  },
}).configure({
  renderText: ({ node }) => mentionText(node.attrs),
  renderHTML: ({ node }) => [
    "span",
    {
      "data-type": "mentionNode",
      "data-read-only-mention": "",
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
      }),
      inlineTokenText(node.attrs),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ComposerInlineTokenNodeView);
  },
});

function createComposerExtensions(placeholderRef: { current: string }) {
  return [
    StarterKit.configure({
      // The composer preserves markdown syntax as plain prompt text. These marks
      // otherwise convert typed markdown like **text** into styled editor content.
      bold: false,
      heading: false,
      code: false,
      link: false,
      italic: false,
      strike: false,
      underline: false,
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
        rel: "noreferrer",
        target: "_blank",
      },
      isAllowedUri: (url, context) => {
        const trimmedUrl = url.trim().toLowerCase();
        return (
          (trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://")) &&
          context.defaultValidate(url)
        );
      },
      shouldAutoLink: () => false,
    }),
    Placeholder.configure({
      placeholder: () => placeholderRef.current,
    }),
    ComposerCommandExtension,
    ComposerMentionExtension,
    ComposerSkillExtension,
    ComposerInlineTokenExtension,
  ];
}

export const ComposerPromptEditor = forwardRef<
  ComposerPromptEditorHandle,
  ComposerPromptEditorProps
>(function ComposerPromptEditor(
  {
    value,
    cursor,
    skills,
    disabled,
    placeholder,
    className,
    hotkeyTargetRef,
    caretAnchorRef,
    commandMenuOpen = false,
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
  const commandMenuOpenRef = useRef(commandMenuOpen);
  const skillMetadata = useMemo(() => skillMetadataByName(skills), [skills]);
  onChangeRef.current = onChange;
  onCommandKeyDownRef.current = onCommandKeyDown;
  onMeasuredMultilineChangeRef.current = onMeasuredMultilineChange;
  onPasteRef.current = onPaste;
  placeholderRef.current = placeholder;
  commandMenuOpenRef.current = commandMenuOpen;
  const localCaretAnchorRef = useRef<HTMLSpanElement | null>(null);
  const setCaretAnchor = useCallback(
    (element: HTMLSpanElement | null) => {
      localCaretAnchorRef.current = element;
      if (caretAnchorRef) {
        caretAnchorRef.current = element;
      }
    },
    [caretAnchorRef],
  );
  const extensionsRef = useRef<ReturnType<typeof createComposerExtensions> | null>(null);
  extensionsRef.current ??= createComposerExtensions(placeholderRef);
  const pendingSurroundSelectionRef = useRef<SurroundSelectionSnapshot | null>(null);
  const isApplyingControlledUpdateRef = useRef(false);
  const measuredMultilineRef = useRef(false);
  const skillMetadataRef = useRef(skillMetadata);
  skillMetadataRef.current = skillMetadata;
  const initialDocRef = useRef(promptToTiptapDoc(value, skillMetadataRef.current));
  const initialCursor = clampCollapsedComposerCursor(value, cursor);
  const initialSnapshotRef = useRef<ComposerPromptEditorSnapshot>({
    value,
    cursor: initialCursor,
    expandedCursor: expandCollapsedComposerCursor(value, initialCursor),
  });
  const snapshotRef = useRef(initialSnapshotRef.current);
  const skillsSignature = skillSignature(skills);
  const skillsSignatureRef = useRef(skillsSignature);
  const emitSnapshotRef = useRef<(editor: Editor) => void>(() => {});
  const keyDownHandlerRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const beforeInputHandlerRef = useRef<(event: InputEvent) => boolean>(() => false);

  const editorClassName = cn(
    "block w-full whitespace-pre-wrap break-words outline-hidden [&>p]:m-0 [&>p.is-editor-empty:first-child::before]:float-left [&>p.is-editor-empty:first-child::before]:h-0 [&>p.is-editor-empty:first-child::before]:max-w-full [&>p.is-editor-empty:first-child::before]:overflow-hidden [&>p.is-editor-empty:first-child::before]:text-ellipsis [&>p.is-editor-empty:first-child::before]:whitespace-nowrap [&>p.is-editor-empty:first-child::before]:font-normal [&>p.is-editor-empty:first-child::before]:text-multi-fg-quaternary [&>p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
    className,
  );

  const editor = useEditor(
    {
      extensions: extensionsRef.current,
      content: initialDocRef.current,
      editable: !disabled,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: editorClassName,
          "data-testid": "composer-editor",
          "data-prompt-editor-input": "true",
          tabindex: "-1",
        },
        handleKeyDown: (_view, event) => keyDownHandlerRef.current(event),
        handleDOMEvents: {
          beforeinput: (_view, event) => beforeInputHandlerRef.current(event as InputEvent),
          paste: (_view, event) => {
            onPasteRef.current(
              event as unknown as Parameters<ClipboardEventHandler<HTMLElement>>[0],
            );
            if (!event.defaultPrevented) {
              const pastedText = event.clipboardData?.getData("text/plain") ?? "";
              if (pastedText.includes("\n")) {
                notifyComposerEditorMultiline(
                  onMeasuredMultilineChangeRef.current,
                  measuredMultilineRef,
                  true,
                );
              }
            }
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
    );
    emitMeasuredMultiline(nextEditor, onMeasuredMultilineChangeRef.current, measuredMultilineRef);
  };

  keyDownHandlerRef.current = (event: KeyboardEvent) => {
    if (!editor) return false;
    const menuOpen = commandMenuOpenRef.current;
    const isAlwaysMenuKey = event.key === "Escape" || event.key === "Enter";
    const isMenuNavigationKey =
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      (event.key === "Tab" && !event.shiftKey);
    if (isAlwaysMenuKey || (menuOpen && isMenuNavigationKey)) {
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
    const surroundSelection = captureSurroundSelection(editor);
    pendingSurroundSelectionRef.current = surroundSelection;
    const close = SURROUND_SYMBOLS_MAP.get(event.key);
    if (
      surroundSelection &&
      close &&
      applySurroundInput(editor, surroundSelection, event.key, close)
    ) {
      event.preventDefault();
      event.stopPropagation();
      pendingSurroundSelectionRef.current = null;
      return true;
    }
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

  usePromptEditorControlledStateSync({
    cursor,
    editor,
    isApplyingControlledUpdateRef,
    measuredMultilineRef,
    onMeasuredMultilineChangeRef,
    skillsSignature,
    skillsSignatureRef,
    skillMetadataRef,
    snapshotRef,
    value,
  });

  usePromptEditorMultilineMeasurement({
    editor,
    measuredMultilineRef,
    onMeasuredMultilineChangeRef,
  });

  usePromptEditorCaretAnchor({
    commandMenuOpen,
    editor,
    anchorElementRef: localCaretAnchorRef,
  });

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

  const replaceRangeWithSkill = useCallback(
    (rangeStart: number, rangeEnd: number, skill: ComposerSkillData): boolean => {
      if (!editor) return false;
      const from = textToPosition(editor.state.doc, rangeStart, "expanded");
      const to = textToPosition(editor.state.doc, rangeEnd, "expanded");
      const safeFrom = Math.min(from, to);
      const safeTo = Math.max(from, to);
      const attrs: Record<string, unknown> = {
        skillName: skill.name,
        skillLabel: skill.label,
      };
      if (skill.description) attrs.skillDescription = skill.description;
      if (skill.path) attrs.skillPath = skill.path;
      return editor
        .chain()
        .focus()
        .deleteRange({ from: safeFrom, to: safeTo })
        .insertContent([
          { type: "skillNode", attrs },
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
        onChangeRef.current("", 0, 0, false);
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
      replaceRangeWithSkill,
      getText: () => readSnapshot().value,
      getCommands: () => (editor ? collectCommands(editor.state.doc) : []),
      getMentions: () => (editor ? collectMentions(editor.state.doc) : []),
      getSubmitData: () => {
        const snapshot = readSnapshot();
        return {
          text: snapshot.value,
          commands: editor ? collectCommands(editor.state.doc) : [],
          mentions: editor ? collectMentions(editor.state.doc) : [],
        };
      },
      readSnapshot,
      editor,
    }),
    [editor, focusAt, insertText, readSnapshot, replaceRangeWithCommand, replaceRangeWithSkill],
  );

  return (
    <div ref={hotkeyTargetRef} className="relative w-full min-w-0">
      {editor ? (
        <PromptEditorEditableSync key={String(disabled)} disabled={disabled} editor={editor} />
      ) : null}
      <EditorContent editor={editor} />
      <span
        ref={setCaretAnchor}
        aria-hidden="true"
        data-composer-menu-anchor=""
        className="pointer-events-none absolute h-px w-px"
        style={{ left: 0, top: 0 }}
      />
    </div>
  );
});

function PromptEditorEditableSync({ disabled, editor }: { disabled: boolean; editor: Editor }) {
  useMountEffect(() => {
    editor.setEditable(!disabled);
  });

  return null;
}
