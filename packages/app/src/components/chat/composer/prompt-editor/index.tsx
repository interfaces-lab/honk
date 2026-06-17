import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { type OrchestrationMessageRichText } from "@honk/contracts";
import {
  $applyNodeReplacement,
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getDOMSlot,
  $getDOMTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  DecoratorNode,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  type EditorState,
  type ElementNode,
  type InitialEditorStateType,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type RangeSelection,
  type SerializedLexicalNode,
} from "lexical";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type ClipboardEventHandler,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type RefObject,
} from "react";

import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  expandCollapsedComposerCursor,
  isCollapsedCursorAdjacentToInlineToken,
} from "../prompt-triggers";
import {
  selectionTouchesMentionBoundary,
  splitPromptIntoComposerSegments,
} from "../prompt-segments";
import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { cn } from "~/lib/utils";
import { basenameOfPath } from "../../shared/vscode-entry-icons";
import {
  ComposerCommandChip,
  ComposerInlineTokenChip,
  ComposerMentionChip,
  ComposerSkillChip,
} from "./chips";
import {
  commandText,
  composerSegmentCollapsedLength,
  composerSegmentExpandedText,
  inlineTokenText,
  mentionText,
  skillText,
} from "./serialization";
import type {
  ComposerCommandData,
  ComposerCommandPayload,
  ComposerDocSegment,
  ComposerInlineTokenPayload,
  ComposerMentionData,
  ComposerMentionPayload,
  ComposerPromptEditorHandle,
  ComposerPromptEditorProps,
  ComposerPromptEditorSnapshot,
  ComposerSkillPayload,
  LexicalSelectionPoint,
  SerializedComposerCommandNode,
  SerializedComposerInlineTokenNode,
  SerializedComposerMentionNode,
  SerializedComposerSkillNode,
  SurroundSelectionSnapshot,
} from "./types";

export type {
  ComposerCommandData,
  ComposerMentionData,
  ComposerPromptEditorHandle,
  ComposerPromptEditorSnapshot,
  ComposerPromptSubmitData,
} from "./types";

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
const EMPTY_DOC: ComposerDocSegment[] = [];

class ComposerMentionNode extends DecoratorNode<ReactElement> {
  __payload: ComposerMentionPayload;

  static override getType(): string {
    return "mentionNode";
  }

  static override clone(node: ComposerMentionNode): ComposerMentionNode {
    return new ComposerMentionNode(node.__payload, node.__key);
  }

  static override importJSON(serializedNode: SerializedLexicalNode): ComposerMentionNode {
    const node = serializedNode as SerializedComposerMentionNode;
    return new ComposerMentionNode({
      path: node.path,
      label: node.label,
      lineStart: node.lineStart,
      lineEnd: node.lineEnd,
    });
  }

  constructor(payload: ComposerMentionPayload = emptyMentionPayload(), key?: NodeKey) {
    super(key);
    this.__payload = payload;
  }

  override exportJSON(): SerializedComposerMentionNode {
    return {
      type: "mentionNode",
      version: 1,
      ...this.__payload,
      text: mentionText(this.__payload),
    };
  }

  override createDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "inline-flex align-middle";
    return element;
  }

  override updateDOM(): false {
    return false;
  }

  override decorate(): ReactElement {
    return <ComposerMentionChip {...this.__payload} />;
  }

  override getTextContent(): string {
    return mentionText(this.__payload);
  }

  override isInline(): true {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return true;
  }
}

class ComposerCommandNode extends DecoratorNode<ReactElement> {
  __payload: ComposerCommandPayload;

  static override getType(): string {
    return "commandNode";
  }

  static override clone(node: ComposerCommandNode): ComposerCommandNode {
    return new ComposerCommandNode(node.__payload, node.__key);
  }

  static override importJSON(serializedNode: SerializedLexicalNode): ComposerCommandNode {
    const node = serializedNode as SerializedComposerCommandNode;
    return new ComposerCommandNode({
      id: node.id,
      name: node.name,
      content: node.content,
      type: node.commandType,
    });
  }

  constructor(payload: ComposerCommandPayload = emptyCommandPayload(), key?: NodeKey) {
    super(key);
    this.__payload = payload;
  }

  override exportJSON(): SerializedComposerCommandNode {
    return {
      id: this.__payload.id,
      name: this.__payload.name,
      content: this.__payload.content,
      commandType: this.__payload.type,
      text: commandText(this.__payload),
      type: "commandNode",
      version: 1,
    };
  }

  override createDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "inline-flex align-middle";
    return element;
  }

  override updateDOM(): false {
    return false;
  }

  override decorate(): ReactElement {
    return <ComposerCommandChip {...this.__payload} />;
  }

  override getTextContent(): string {
    return commandText(this.__payload);
  }

  override isInline(): true {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return true;
  }
}

class ComposerSkillNode extends DecoratorNode<ReactElement> {
  __payload: ComposerSkillPayload;

  static override getType(): string {
    return "skillNode";
  }

  static override clone(node: ComposerSkillNode): ComposerSkillNode {
    return new ComposerSkillNode(node.__payload, node.__key);
  }

  static override importJSON(serializedNode: SerializedLexicalNode): ComposerSkillNode {
    const node = serializedNode as SerializedComposerSkillNode;
    return new ComposerSkillNode({
      name: node.name,
      label: node.label,
      description: node.description,
      path: node.path,
    });
  }

  constructor(payload: ComposerSkillPayload = emptySkillPayload(), key?: NodeKey) {
    super(key);
    this.__payload = payload;
  }

  override exportJSON(): SerializedComposerSkillNode {
    return {
      type: "skillNode",
      version: 1,
      ...this.__payload,
      text: skillText(this.__payload),
    };
  }

  override createDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "inline-flex align-middle";
    return element;
  }

  override updateDOM(): false {
    return false;
  }

  override decorate(): ReactElement {
    return <ComposerSkillChip {...this.__payload} />;
  }

  override getTextContent(): string {
    return skillText(this.__payload);
  }

  override isInline(): true {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return true;
  }
}

class ComposerInlineTokenNode extends DecoratorNode<ReactElement> {
  __payload: ComposerInlineTokenPayload;

  static override getType(): string {
    return "inlineTokenNode";
  }

  static override clone(node: ComposerInlineTokenNode): ComposerInlineTokenNode {
    return new ComposerInlineTokenNode(node.__payload, node.__key);
  }

  static override importJSON(serializedNode: SerializedLexicalNode): ComposerInlineTokenNode {
    const node = serializedNode as SerializedComposerInlineTokenNode;
    return new ComposerInlineTokenNode({
      label: node.label,
      sourceUri: node.sourceUri,
      markdown: node.markdown,
    });
  }

  constructor(payload: ComposerInlineTokenPayload = emptyInlineTokenPayload(), key?: NodeKey) {
    super(key);
    this.__payload = payload;
  }

  override exportJSON(): SerializedComposerInlineTokenNode {
    return {
      type: "inlineTokenNode",
      version: 1,
      ...this.__payload,
      text: inlineTokenText(this.__payload),
    };
  }

  override createDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "inline-flex align-middle";
    return element;
  }

  override updateDOM(): false {
    return false;
  }

  override decorate(): ReactElement {
    return <ComposerInlineTokenChip {...this.__payload} />;
  }

  override getTextContent(): string {
    return inlineTokenText(this.__payload);
  }

  override isInline(): true {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return true;
  }
}

type ComposerAtomNode =
  | ComposerMentionNode
  | ComposerCommandNode
  | ComposerSkillNode
  | ComposerInlineTokenNode;

function emptyMentionPayload(): ComposerMentionPayload {
  return { path: "", label: null, lineStart: null, lineEnd: null };
}

function emptyCommandPayload(): ComposerCommandPayload {
  return { id: "", name: "", content: null, type: null };
}

function emptySkillPayload(): ComposerSkillPayload {
  return { name: "", label: "", description: null, path: null };
}

function emptyInlineTokenPayload(): ComposerInlineTokenPayload {
  return { label: "", sourceUri: "", markdown: "" };
}

function $createComposerMentionNode(payload: ComposerMentionPayload): ComposerMentionNode {
  return $applyNodeReplacement(new ComposerMentionNode(payload));
}

function $createComposerCommandNode(payload: ComposerCommandPayload): ComposerCommandNode {
  return $applyNodeReplacement(new ComposerCommandNode(payload));
}

function $createComposerSkillNode(payload: ComposerSkillPayload): ComposerSkillNode {
  return $applyNodeReplacement(new ComposerSkillNode(payload));
}

function $createComposerInlineTokenNode(
  payload: ComposerInlineTokenPayload,
): ComposerInlineTokenNode {
  return $applyNodeReplacement(new ComposerInlineTokenNode(payload));
}

function isComposerAtomNode(node: LexicalNode | null | undefined): node is ComposerAtomNode {
  return (
    node instanceof ComposerMentionNode ||
    node instanceof ComposerCommandNode ||
    node instanceof ComposerSkillNode ||
    node instanceof ComposerInlineTokenNode
  );
}

function atomNodeToSegment(node: ComposerAtomNode): ComposerDocSegment {
  if (node instanceof ComposerMentionNode) {
    return { type: "mention", payload: node.__payload };
  }
  if (node instanceof ComposerCommandNode) {
    return { type: "command", payload: node.__payload };
  }
  if (node instanceof ComposerSkillNode) {
    return { type: "skill", payload: node.__payload };
  }
  return { type: "inline-token", payload: node.__payload };
}

function promptToComposerSegments(prompt: string): ComposerDocSegment[] {
  if (!prompt) {
    return EMPTY_DOC;
  }

  const segments: ComposerDocSegment[] = [];
  for (const segment of splitPromptIntoComposerSegments(prompt)) {
    if (segment.type === "text") {
      segments.push({ type: "text", text: segment.text });
      continue;
    }
    if (segment.type === "mention") {
      segments.push({
        type: "mention",
        payload: {
          path: segment.path,
          label: basenameOfPath(segment.path),
          lineStart: null,
          lineEnd: null,
        },
      });
      continue;
    }
    if (segment.type === "skill") {
      segments.push({
        type: "skill",
        payload: {
          name: segment.name,
          label: segment.name,
          description: null,
          path: segment.path ?? null,
        },
      });
      continue;
    }
    segments.push({
      type: "inline-token",
      payload: {
        label: segment.label,
        sourceUri: segment.sourceUri,
        markdown: segment.markdown,
      },
    });
  }
  return segments;
}

function appendTextToParagraph(paragraph: ElementNode, text: string): void {
  const parts = text.split("\n");
  parts.forEach((part, index) => {
    if (index > 0) {
      paragraph.append($createLineBreakNode());
    }
    if (part.length > 0) {
      paragraph.append($createTextNode(part));
    }
  });
}

function appendSegmentToParagraph(paragraph: ElementNode, segment: ComposerDocSegment): void {
  switch (segment.type) {
    case "text":
      appendTextToParagraph(paragraph, segment.text);
      return;
    case "linebreak":
      paragraph.append($createLineBreakNode());
      return;
    case "mention":
      paragraph.append($createComposerMentionNode(segment.payload));
      return;
    case "command":
      paragraph.append($createComposerCommandNode(segment.payload));
      return;
    case "skill":
      paragraph.append($createComposerSkillNode(segment.payload));
      return;
    case "inline-token":
      paragraph.append($createComposerInlineTokenNode(segment.payload));
      return;
  }
}

function setRootFromSegments(segments: ReadonlyArray<ComposerDocSegment>): void {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  for (const segment of segments) {
    appendSegmentToParagraph(paragraph, segment);
  }
  root.append(paragraph);
}

function setRootFromPrompt(prompt: string): void {
  setRootFromSegments(promptToComposerSegments(prompt));
}

function collectSegmentsFromNode(node: LexicalNode, segments: ComposerDocSegment[]): void {
  if ($isTextNode(node)) {
    const text = node.getTextContent();
    if (text.length > 0) {
      segments.push({ type: "text", text });
    }
    return;
  }
  if ($isLineBreakNode(node)) {
    segments.push({ type: "linebreak" });
    return;
  }
  if (isComposerAtomNode(node)) {
    segments.push(atomNodeToSegment(node));
    return;
  }
  if ($isElementNode(node)) {
    for (const child of node.getChildren()) {
      collectSegmentsFromNode(child, segments);
    }
  }
}

function collectComposerSegmentsFromRoot(): ComposerDocSegment[] {
  const root = $getRoot();
  const segments: ComposerDocSegment[] = [];
  root.getChildren().forEach((child, index) => {
    if (index > 0) {
      segments.push({ type: "linebreak" });
    }
    collectSegmentsFromNode(child, segments);
  });
  return segments;
}

function nodeTextLength(node: LexicalNode, mode: "expanded" | "collapsed"): number {
  if ($isTextNode(node)) {
    return node.getTextContent().length;
  }
  if ($isLineBreakNode(node)) {
    return 1;
  }
  if (isComposerAtomNode(node)) {
    return mode === "expanded" ? node.getTextContent().length : 1;
  }
  if ($isElementNode(node)) {
    return node.getChildren().reduce((total, child) => total + nodeTextLength(child, mode), 0);
  }
  return node.getTextContent().length;
}

function offsetBeforePointInNode(
  node: LexicalNode,
  point: RangeSelection["focus"],
  mode: "expanded" | "collapsed",
): { found: boolean; offset: number } {
  if (point.type === "element" && point.key === node.getKey() && $isElementNode(node)) {
    const offset = node
      .getChildren()
      .slice(0, point.offset)
      .reduce((total, child) => total + nodeTextLength(child, mode), 0);
    return { found: true, offset };
  }
  if (point.key === node.getKey()) {
    if ($isTextNode(node)) {
      return { found: true, offset: Math.min(point.offset, node.getTextContent().length) };
    }
    return { found: true, offset: point.offset > 0 ? nodeTextLength(node, mode) : 0 };
  }
  if (!$isElementNode(node)) {
    return { found: false, offset: nodeTextLength(node, mode) };
  }

  let offset = 0;
  for (const child of node.getChildren()) {
    const result = offsetBeforePointInNode(child, point, mode);
    if (result.found) {
      return { found: true, offset: offset + result.offset };
    }
    offset += result.offset;
  }
  return { found: false, offset };
}

function offsetBeforePoint(point: RangeSelection["focus"], mode: "expanded" | "collapsed"): number {
  return offsetBeforePointInNode($getRoot(), point, mode).offset;
}

function pointAroundNode(node: LexicalNode, after: boolean): LexicalSelectionPoint {
  const parent = node.getParentOrThrow<ElementNode>();
  return {
    key: parent.getKey(),
    offset: node.getIndexWithinParent() + (after ? 1 : 0),
    type: "element",
  };
}

function findPointInNodeAtOffset(
  node: LexicalNode,
  targetOffset: number,
  mode: "expanded" | "collapsed",
): { found: boolean; point: LexicalSelectionPoint; remaining: number } {
  if ($isTextNode(node)) {
    const textLength = node.getTextContent().length;
    if (targetOffset <= textLength) {
      return {
        found: true,
        point: {
          key: node.getKey(),
          offset: Math.max(0, targetOffset),
          type: "text",
        },
        remaining: 0,
      };
    }
    return {
      found: false,
      point: pointAroundNode(node, true),
      remaining: targetOffset - textLength,
    };
  }

  if ($isLineBreakNode(node) || isComposerAtomNode(node)) {
    const length = nodeTextLength(node, mode);
    if (targetOffset === 0) {
      return { found: true, point: pointAroundNode(node, false), remaining: 0 };
    }
    if (targetOffset <= length) {
      return { found: true, point: pointAroundNode(node, true), remaining: 0 };
    }
    return {
      found: false,
      point: pointAroundNode(node, true),
      remaining: targetOffset - length,
    };
  }

  if ($isElementNode(node)) {
    let remaining = targetOffset;
    const children = node.getChildren();
    if (children.length === 0 || remaining === 0) {
      return {
        found: true,
        point: { key: node.getKey(), offset: 0, type: "element" },
        remaining: 0,
      };
    }
    for (const child of children) {
      const result = findPointInNodeAtOffset(child, remaining, mode);
      if (result.found) {
        return result;
      }
      remaining = result.remaining;
    }
    return {
      found: false,
      point: { key: node.getKey(), offset: children.length, type: "element" },
      remaining,
    };
  }

  return {
    found: false,
    point: pointAroundNode(node, true),
    remaining: Math.max(0, targetOffset - node.getTextContent().length),
  };
}

function pointAtTextOffset(offset: number, mode: "expanded" | "collapsed"): LexicalSelectionPoint {
  const root = $getRoot();
  const safeOffset = Math.max(0, Math.floor(offset));
  const result = findPointInNodeAtOffset(root, safeOffset, mode);
  return result.point;
}

function setSelectionRangeAtTextOffsets(
  start: number,
  end: number,
  mode: "expanded" | "collapsed",
): void {
  const anchor = pointAtTextOffset(start, mode);
  const focus = pointAtTextOffset(end, mode);
  const selection = $createRangeSelection();
  selection.anchor.set(anchor.key, anchor.offset, anchor.type);
  selection.focus.set(focus.key, focus.offset, focus.type);
  $setSelection(selection);
}

function setSelectionAtTextOffset(offset: number, mode: "expanded" | "collapsed"): void {
  setSelectionRangeAtTextOffsets(offset, offset, mode);
}

function readSnapshotFromEditorState(): ComposerPromptEditorSnapshot {
  const root = $getRoot();
  const value = root.getTextContent();
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    const cursor = nodeTextLength(root, "collapsed");
    return {
      value,
      cursor,
      expandedCursor: value.length,
    };
  }
  return {
    value,
    cursor: offsetBeforePoint(selection.focus, "collapsed"),
    expandedCursor: offsetBeforePoint(selection.focus, "expanded"),
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

function measureComposerEditorMultiline(editor: LexicalEditor): boolean {
  const rootElement = editor.getRootElement();
  if (!rootElement) {
    return false;
  }
  const text = rootElement.textContent ?? "";
  if (text.includes("\n")) {
    return true;
  }
  if (text.trim().length === 0) {
    return false;
  }
  return rootElement.scrollHeight > COMPOSER_EDITOR_MULTILINE_PIXEL_THRESHOLD;
}

function emitMeasuredMultiline(
  editor: LexicalEditor,
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

function updateEditorFromControlledState({
  cursor,
  editor,
  forceRewrite,
  isApplyingControlledUpdateRef,
  measuredMultilineRef,
  onMeasuredMultilineChangeRef,
  snapshotRef,
  syncRevision,
  syncRevisionRef,
  value,
}: {
  cursor: number;
  editor: LexicalEditor;
  forceRewrite: boolean;
  isApplyingControlledUpdateRef: RefObject<boolean>;
  measuredMultilineRef: RefObject<boolean>;
  onMeasuredMultilineChangeRef: RefObject<ComposerPromptEditorProps["onMeasuredMultilineChange"]>;
  snapshotRef: RefObject<ComposerPromptEditorSnapshot>;
  syncRevision: number;
  syncRevisionRef: RefObject<number>;
  value: string;
}) {
  const previousSnapshot = snapshotRef.current;
  const syncRevisionChanged = syncRevisionRef.current !== syncRevision;
  if (!syncRevisionChanged) {
    return;
  }

  const nextValue = value;
  const normalizedCursor = clampCollapsedComposerCursor(nextValue, cursor);

  snapshotRef.current = {
    value: nextValue,
    cursor: normalizedCursor,
    expandedCursor: expandCollapsedComposerCursor(nextValue, normalizedCursor),
  };
  syncRevisionRef.current = syncRevision;

  isApplyingControlledUpdateRef.current = true;
  const shouldRewriteEditorState = forceRewrite || previousSnapshot.value !== nextValue;
  editor.update(() => {
    if (shouldRewriteEditorState) {
      setRootFromPrompt(nextValue);
    }
    setSelectionAtTextOffset(normalizedCursor, "collapsed");
  });
  emitMeasuredMultiline(editor, onMeasuredMultilineChangeRef.current, measuredMultilineRef);
  queueMicrotask(() => {
    isApplyingControlledUpdateRef.current = false;
  });
}

function usePromptEditorControlledStateSync({
  cursor,
  editor,
  forceSyncGeneration = 0,
  isApplyingControlledUpdateRef,
  measuredMultilineRef,
  onMeasuredMultilineChangeRef,
  snapshotRef,
  syncRevision,
  syncRevisionRef,
  value,
}: {
  cursor: number;
  editor: LexicalEditor;
  forceSyncGeneration?: number;
  isApplyingControlledUpdateRef: RefObject<boolean>;
  measuredMultilineRef: RefObject<boolean>;
  onMeasuredMultilineChangeRef: RefObject<ComposerPromptEditorProps["onMeasuredMultilineChange"]>;
  snapshotRef: RefObject<ComposerPromptEditorSnapshot>;
  syncRevision: number;
  syncRevisionRef: RefObject<number>;
  value: string;
}) {
  const forceSyncGenerationRef = useRef(forceSyncGeneration);
  const forceRewrite =
    forceSyncGenerationRef.current !== forceSyncGeneration && forceSyncGeneration > 0;
  forceSyncGenerationRef.current = forceSyncGeneration;

  useLayoutSyncEffect(() => {
    updateEditorFromControlledState({
      cursor,
      editor,
      forceRewrite,
      isApplyingControlledUpdateRef,
      measuredMultilineRef,
      onMeasuredMultilineChangeRef,
      snapshotRef,
      syncRevision,
      syncRevisionRef,
      value,
    });
  }, [editor, forceSyncGeneration, measuredMultilineRef, syncRevision]);
}

function usePromptEditorMultilineMeasurement({
  editor,
  measuredMultilineRef,
  onMeasuredMultilineChangeRef,
}: {
  editor: LexicalEditor;
  measuredMultilineRef: RefObject<boolean>;
  onMeasuredMultilineChangeRef: RefObject<ComposerPromptEditorProps["onMeasuredMultilineChange"]>;
}) {
  useLayoutSyncEffect(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;
    emitMeasuredMultiline(editor, onMeasuredMultilineChangeRef.current, measuredMultilineRef);
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      emitMeasuredMultiline(editor, onMeasuredMultilineChangeRef.current, measuredMultilineRef);
    });
    observer.observe(rootElement);
    return () => {
      observer.disconnect();
    };
  }, [editor]);
}

function lastTextNodeIn(node: Node): Text | null {
  if (node instanceof Text) {
    return node.data.length > 0 ? node : null;
  }
  for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
    const child = node.childNodes[index];
    if (!child) continue;
    const text = lastTextNodeIn(child);
    if (text) return text;
  }
  return null;
}

function previousTextNodeBefore(node: Node, root: HTMLElement): Text | null {
  let current: Node | null = node;
  while (current && current !== root) {
    let sibling = current.previousSibling;
    while (sibling) {
      const text = lastTextNodeIn(sibling);
      if (text) return text;
      sibling = sibling.previousSibling;
    }
    current = current.parentNode;
  }
  return null;
}

function previousTextPosition(
  container: Node,
  offset: number,
  editorRoot: HTMLElement,
): { node: Text; offset: number } | null {
  if (container instanceof Text) {
    const safeOffset = Math.min(offset, container.data.length);
    if (safeOffset > 0) {
      return { node: container, offset: safeOffset };
    }
    const previous = previousTextNodeBefore(container, editorRoot);
    return previous ? { node: previous, offset: previous.data.length } : null;
  }

  const childOffset = Math.min(offset, container.childNodes.length);
  for (let index = childOffset - 1; index >= 0; index -= 1) {
    const child = container.childNodes[index];
    if (!child) continue;
    const text = lastTextNodeIn(child);
    if (text) {
      return { node: text, offset: text.data.length };
    }
  }

  const previous = previousTextNodeBefore(container, editorRoot);
  return previous ? { node: previous, offset: previous.data.length } : null;
}

function caretRectAfterPreviousCharacter(range: Range, editorRoot: HTMLElement): DOMRect | null {
  const position = previousTextPosition(range.startContainer, range.startOffset, editorRoot);
  if (!position || position.offset <= 0) {
    return null;
  }

  const previousCharacterRange = document.createRange();
  previousCharacterRange.setStart(position.node, position.offset - 1);
  previousCharacterRange.setEnd(position.node, position.offset);
  const rects = previousCharacterRange.getClientRects();
  const rect = rects[rects.length - 1] ?? previousCharacterRange.getBoundingClientRect();
  return rect.width === 0 && rect.height === 0
    ? null
    : new DOMRect(rect.right, rect.top, 1, rect.height);
}

function caretRectFromDomSelection(editorRoot: HTMLElement): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const anchorNode = selection.anchorNode;
  if (!anchorNode || !editorRoot.contains(anchorNode)) {
    return null;
  }
  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  return rect.width === 0 && rect.height === 0
    ? caretRectAfterPreviousCharacter(range, editorRoot)
    : rect;
}

type DomRangePoint = { node: Node; offset: number };

function childIndex(parent: Node, child: Node): number | null {
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    if (parent.childNodes[index] === child) {
      return index;
    }
  }
  return null;
}

function domPointForLexicalPoint(
  editor: LexicalEditor,
  point: LexicalSelectionPoint,
): DomRangePoint | null {
  const lexicalNode = $getNodeByKey<LexicalNode>(point.key);
  if (!lexicalNode) {
    return null;
  }

  const keyedElement = editor.getElementByKey(lexicalNode.getKey());
  if (!keyedElement) {
    return null;
  }

  if ($isElementNode(lexicalNode)) {
    const slot = $getDOMSlot(lexicalNode, keyedElement, editor);
    const offset = Math.max(
      0,
      Math.min(point.offset + slot.getFirstChildOffset(), slot.element.childNodes.length),
    );
    return { node: slot.element, offset };
  }

  if ($isTextNode(lexicalNode)) {
    const textNode = $getDOMTextNode(lexicalNode, keyedElement, editor);
    if (!textNode) {
      return null;
    }
    return {
      node: textNode,
      offset: Math.max(0, Math.min(point.offset, textNode.data.length)),
    };
  }

  const parent = keyedElement.parentNode;
  if (!parent) {
    return null;
  }
  const index = childIndex(parent, keyedElement);
  if (index === null) {
    return null;
  }
  return { node: parent, offset: index + (point.offset > 0 ? 1 : 0) };
}

function triggerStartRectFromTextOffset(editor: LexicalEditor, offset: number): DOMRect | null {
  const points = editor.getEditorState().read(
    () => ({
      start: domPointForLexicalPoint(editor, pointAtTextOffset(offset, "expanded")),
      end: domPointForLexicalPoint(editor, pointAtTextOffset(offset + 1, "expanded")),
    }),
    { editor },
  );

  if (!points.start || !points.end) {
    return null;
  }

  const range = document.createRange();
  try {
    range.setStart(points.start.node, points.start.offset);
    range.setEnd(points.end.node, points.end.offset);
  } catch {
    return null;
  }
  if (range.collapsed) {
    return null;
  }

  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  return rect.width === 0 && rect.height === 0
    ? null
    : new DOMRect(rect.left, rect.top, 1, rect.height);
}

function commandMenuAnchorRect(
  editor: LexicalEditor,
  editorRoot: HTMLElement,
  anchorExpandedOffset: number | null,
): DOMRect | null {
  if (anchorExpandedOffset !== null) {
    return (
      triggerStartRectFromTextOffset(editor, anchorExpandedOffset) ??
      caretRectFromDomSelection(editorRoot)
    );
  }
  return caretRectFromDomSelection(editorRoot);
}

// Mirrors Cursor's live menu anchor: a real 1x1 span whose position is
// rewritten from the trigger origin (falling back to the DOM caret). Floating
// UI reads the live DOM rect via MutationObserver-driven updates, not React
// state per keystroke.
function usePromptEditorCaretAnchor({
  commandMenuAnchorExpandedOffset,
  commandMenuOpen,
  editor,
  anchorElementRef,
}: {
  commandMenuAnchorExpandedOffset: number | null;
  commandMenuOpen: boolean;
  editor: LexicalEditor;
  anchorElementRef: RefObject<HTMLSpanElement | null>;
}) {
  useLayoutSyncEffect(() => {
    if (!commandMenuOpen) return;
    const anchor = anchorElementRef.current;
    const editorRoot = editor.getRootElement();
    const anchorRoot =
      anchor?.offsetParent instanceof HTMLElement ? anchor.offsetParent : anchor?.parentElement;
    if (!anchor || !anchorRoot || !editorRoot) return;

    let frame: number | null = null;
    const place = () => {
      const rect =
        commandMenuAnchorRect(editor, editorRoot, commandMenuAnchorExpandedOffset) ??
        editorRoot.getBoundingClientRect();
      const anchorRootRect = anchorRoot.getBoundingClientRect();
      anchor.style.left = `${rect.left - anchorRootRect.left}px`;
      anchor.style.top = `${rect.top - anchorRootRect.top}px`;
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
    const unregisterUpdate = editor.registerUpdateListener(schedulePlace);
    document.addEventListener("selectionchange", schedulePlace);
    if (typeof ResizeObserver === "undefined") {
      return () => {
        unregisterUpdate();
        document.removeEventListener("selectionchange", schedulePlace);
        if (frame !== null) {
          window.cancelAnimationFrame(frame);
        }
      };
    }
    const observer = new ResizeObserver(schedulePlace);
    observer.observe(editorRoot);
    observer.observe(anchorRoot);
    return () => {
      unregisterUpdate();
      document.removeEventListener("selectionchange", schedulePlace);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
    };
  }, [anchorElementRef, commandMenuAnchorExpandedOffset, commandMenuOpen, editor]);
}

function captureSurroundSelection(editor: LexicalEditor): SurroundSelectionSnapshot | null {
  let snapshot: SurroundSelectionSnapshot | null = null;
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || selection.isCollapsed()) {
      snapshot = null;
      return;
    }
    if (selection.getNodes().some(isComposerAtomNode)) {
      snapshot = null;
      return;
    }
    const value = readSnapshotFromEditorState().value;
    const anchorOffset = offsetBeforePoint(selection.anchor, "expanded");
    const focusOffset = offsetBeforePoint(selection.focus, "expanded");
    const start = Math.min(anchorOffset, focusOffset);
    const end = Math.max(anchorOffset, focusOffset);
    if (selectionTouchesMentionBoundary(value, start, end)) {
      snapshot = null;
      return;
    }
    snapshot = { start, end, value };
  });
  return snapshot;
}

function replaceSegmentsInExpandedRange(
  segments: ReadonlyArray<ComposerDocSegment>,
  start: number,
  end: number,
  insertion: ReadonlyArray<ComposerDocSegment>,
): ComposerDocSegment[] {
  const next: ComposerDocSegment[] = [];
  let offset = 0;
  let inserted = false;

  const insertOnce = () => {
    if (inserted) return;
    next.push(...insertion);
    inserted = true;
  };

  for (const segment of segments) {
    const segmentText = composerSegmentExpandedText(segment);
    const segmentStart = offset;
    const segmentEnd = segmentStart + segmentText.length;
    offset = segmentEnd;

    if (segmentEnd <= start) {
      next.push(segment);
      continue;
    }
    if (segmentStart >= end) {
      insertOnce();
      next.push(segment);
      continue;
    }
    if (segment.type !== "text") {
      continue;
    }
    const beforeEnd = Math.max(0, start - segmentStart);
    const afterStart = Math.max(beforeEnd, end - segmentStart);
    if (beforeEnd > 0) {
      next.push({ type: "text", text: segment.text.slice(0, beforeEnd) });
    }
    insertOnce();
    if (afterStart < segment.text.length) {
      next.push({ type: "text", text: segment.text.slice(afterStart) });
    }
  }

  insertOnce();
  return next;
}

function applySurroundInput(
  editor: LexicalEditor,
  snapshot: SurroundSelectionSnapshot,
  open: string,
  close: string,
): boolean {
  let applied = false;
  editor.update(() => {
    const current = readSnapshotFromEditorState();
    if (current.value !== snapshot.value) {
      return;
    }
    const selectedText = snapshot.value.slice(snapshot.start, snapshot.end);
    const segments = replaceSegmentsInExpandedRange(
      collectComposerSegmentsFromRoot(),
      snapshot.start,
      snapshot.end,
      [{ type: "text", text: `${open}${selectedText}${close}` }],
    );
    setRootFromSegments(segments);
    setSelectionRangeAtTextOffsets(
      snapshot.start + open.length,
      snapshot.end + open.length,
      "expanded",
    );
    applied = true;
  });
  return applied;
}

function insertTextAtSelection(editor: LexicalEditor, text: string): void {
  editor.update(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      selection.insertRawText(text);
    }
  });
}

function insertMentionAtSelection(editor: LexicalEditor, payload: ComposerMentionPayload): void {
  editor.update(() => {
    let selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      $getRoot().selectEnd();
      selection = $getSelection();
    }
    if ($isRangeSelection(selection)) {
      selection.insertNodes([$createComposerMentionNode(payload), $createTextNode(" ")]);
    }
  });
}

function collectCommands(editor: LexicalEditor): ComposerCommandData[] {
  const commands: ComposerCommandData[] = [];
  editor.getEditorState().read(() => {
    for (const node of $nodesOfType(ComposerCommandNode)) {
      commands.push(node.__payload);
    }
  });
  return commands;
}

function collectMentions(editor: LexicalEditor): ComposerMentionData[] {
  const mentions: ComposerMentionData[] = [];
  editor.getEditorState().read(() => {
    for (const node of $nodesOfType(ComposerMentionNode)) {
      mentions.push(node.__payload);
    }
  });
  return mentions;
}

function readSnapshot(editor: LexicalEditor): ComposerPromptEditorSnapshot {
  let snapshot: ComposerPromptEditorSnapshot | null = null;
  editor.getEditorState().read(() => {
    snapshot = readSnapshotFromEditorState();
  });
  return snapshot ?? { value: "", cursor: 0, expandedCursor: 0 };
}

function readSnapshotFromLexicalState(editorState: EditorState): ComposerPromptEditorSnapshot {
  let snapshot: ComposerPromptEditorSnapshot | null = null;
  editorState.read(() => {
    snapshot = readSnapshotFromEditorState();
  });
  return snapshot ?? { value: "", cursor: 0, expandedCursor: 0 };
}

function readRichText(editorState: EditorState): OrchestrationMessageRichText {
  return editorState.toJSON() as unknown as OrchestrationMessageRichText;
}

function lexicalEditorStateFromPrompt(value: string): InitialEditorStateType {
  return () => {
    setRootFromPrompt(value);
    const collapsedCursor = clampCollapsedComposerCursor(value, value.length);
    setSelectionAtTextOffset(collapsedCursor, "collapsed");
  };
}

const composerTheme = {
  paragraph: "honk-lexical-composer-paragraph",
};

export const ComposerPromptEditor = forwardRef<
  ComposerPromptEditorHandle,
  ComposerPromptEditorProps
>(function ComposerPromptEditor({ value, disabled, ...props }, ref) {
  const initialConfig: InitialConfigType = {
    namespace: "honk-composer-prompt-editor",
    editable: !disabled,
    nodes: [ComposerMentionNode, ComposerCommandNode, ComposerSkillNode, ComposerInlineTokenNode],
    editorState: lexicalEditorStateFromPrompt(value),
    theme: composerTheme,
    onError: (error) => {
      throw error;
    },
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <ComposerPromptEditorInner
        {...props}
        ref={ref}
        disabled={disabled}
        value={value}
        syncRevision={props.syncRevision}
      />
    </LexicalComposer>
  );
});

const ComposerPromptEditorInner = forwardRef<ComposerPromptEditorHandle, ComposerPromptEditorProps>(
  function ComposerPromptEditorInner(
    {
      value,
      cursor,
      syncRevision,
      forceSyncGeneration = 0,
      disabled,
      placeholder,
      className,
      hotkeyTargetRef,
      caretAnchorRef,
      commandMenuAnchorExpandedOffset = null,
      commandMenuOpen = false,
      onMeasuredMultilineChange,
      onChange,
      onCommandKeyDown,
      onPaste,
    },
    ref,
  ) {
    const [editor] = useLexicalComposerContext();
    const onChangeRef = useRef(onChange);
    const onCommandKeyDownRef = useRef(onCommandKeyDown);
    const onMeasuredMultilineChangeRef = useRef(onMeasuredMultilineChange);
    const onPasteRef = useRef(onPaste);
    const commandMenuOpenRef = useRef(commandMenuOpen);
    onChangeRef.current = onChange;
    onCommandKeyDownRef.current = onCommandKeyDown;
    onMeasuredMultilineChangeRef.current = onMeasuredMultilineChange;
    onPasteRef.current = onPaste;
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
    const pendingSurroundSelectionRef = useRef<SurroundSelectionSnapshot | null>(null);
    const isApplyingControlledUpdateRef = useRef(false);
    const measuredMultilineRef = useRef(false);
    const initialCursor = clampCollapsedComposerCursor(value, cursor);
    const initialSnapshotRef = useRef<ComposerPromptEditorSnapshot>({
      value,
      cursor: initialCursor,
      expandedCursor: expandCollapsedComposerCursor(value, initialCursor),
    });
    const snapshotRef = useRef(initialSnapshotRef.current);
    const syncRevisionRef = useRef(syncRevision);

    usePromptEditorControlledStateSync({
      cursor,
      editor,
      forceSyncGeneration,
      isApplyingControlledUpdateRef,
      measuredMultilineRef,
      onMeasuredMultilineChangeRef,
      snapshotRef,
      syncRevision,
      syncRevisionRef,
      value,
    });

    usePromptEditorMultilineMeasurement({
      editor,
      measuredMultilineRef,
      onMeasuredMultilineChangeRef,
    });

    usePromptEditorCaretAnchor({
      commandMenuAnchorExpandedOffset,
      commandMenuOpen,
      editor,
      anchorElementRef: localCaretAnchorRef,
    });

    const emitSnapshot = useCallback((editorState: EditorState, nextEditor: LexicalEditor) => {
      if (isApplyingControlledUpdateRef.current) {
        return;
      }
      const nextSnapshot = readSnapshotFromLexicalState(editorState);
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
    }, []);

    const focusAt = (nextCursor: number) => {
      const boundedCursor = clampCollapsedComposerCursor(snapshotRef.current.value, nextCursor);
      editor.focus(() => {
        editor.update(() => {
          setSelectionAtTextOffset(boundedCursor, "collapsed");
        });
        const nextSnapshot = readSnapshot(editor);
        snapshotRef.current = nextSnapshot;
        onChangeRef.current(
          nextSnapshot.value,
          nextSnapshot.cursor,
          nextSnapshot.expandedCursor,
          false,
        );
      });
    };

    const insertText = (text: string) => {
      if (!text) return;
      editor.focus(() => {
        insertTextAtSelection(editor, text);
      });
    };

    const insertMention = (payload: ComposerMentionPayload) => {
      editor.focus(() => {
        insertMentionAtSelection(editor, payload);
      });
      const nextSnapshot = readSnapshot(editor);
      snapshotRef.current = nextSnapshot;
      onChangeRef.current(
        nextSnapshot.value,
        nextSnapshot.cursor,
        nextSnapshot.expandedCursor,
        false,
      );
    };

    const focusAtRef = useRef(focusAt);
    const insertTextRef = useRef(insertText);
    const insertMentionRef = useRef(insertMention);
    focusAtRef.current = focusAt;
    insertTextRef.current = insertText;
    insertMentionRef.current = insertMention;

    const handleCommandKeyDown = (
      key: "ArrowDown" | "ArrowUp" | "Enter" | "Escape" | "Tab",
      event: KeyboardEvent,
    ): boolean => {
      const handled = onCommandKeyDownRef.current?.(key, event) ?? false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
        pendingSurroundSelectionRef.current = null;
      }
      return handled;
    };

    useLayoutSyncEffect(() => {
      const unregisterArrowDown = editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => (event ? handleCommandKeyDown("ArrowDown", event) : false),
        COMMAND_PRIORITY_HIGH,
      );
      const unregisterArrowUp = editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => (event ? handleCommandKeyDown("ArrowUp", event) : false),
        COMMAND_PRIORITY_HIGH,
      );
      const unregisterEnter = editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => (event ? handleCommandKeyDown("Enter", event) : false),
        COMMAND_PRIORITY_HIGH,
      );
      const unregisterTab = editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => (event ? handleCommandKeyDown("Tab", event) : false),
        COMMAND_PRIORITY_HIGH,
      );

      return () => {
        unregisterArrowDown();
        unregisterArrowUp();
        unregisterEnter();
        unregisterTab();
      };
    }, [editor]);

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape" && handleCommandKeyDown("Escape", event.nativeEvent)) {
        return;
      }

      if (
        event.defaultPrevented ||
        event.nativeEvent.isComposing ||
        event.metaKey ||
        event.ctrlKey
      ) {
        pendingSurroundSelectionRef.current = null;
        return;
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
      }
    };

    const handleBeforeInput = (event: FormEvent<HTMLDivElement>) => {
      const inputEvent = event.nativeEvent;
      if (!(inputEvent instanceof InputEvent)) {
        pendingSurroundSelectionRef.current = null;
        return;
      }
      const pendingSelection = pendingSurroundSelectionRef.current;
      if (!pendingSelection) {
        return;
      }
      if (inputEvent.inputType === "insertCompositionText") {
        return;
      }
      if (inputEvent.inputType !== "insertText" || typeof inputEvent.data !== "string") {
        pendingSurroundSelectionRef.current = null;
        return;
      }
      const close = SURROUND_SYMBOLS_MAP.get(inputEvent.data);
      if (!close) {
        pendingSurroundSelectionRef.current = null;
        return;
      }
      if (!applySurroundInput(editor, pendingSelection, inputEvent.data, close)) {
        pendingSurroundSelectionRef.current = null;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      pendingSurroundSelectionRef.current = null;
    };

    const handlePaste: ClipboardEventHandler<HTMLDivElement> = (event) => {
      onPasteRef.current(event as unknown as Parameters<ClipboardEventHandler<HTMLElement>>[0]);
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
    };

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          focusAtRef.current(snapshotRef.current.cursor);
        },
        blur: () => {
          editor.blur();
        },
        clear: () => {
          editor.update(() => {
            setRootFromSegments(EMPTY_DOC);
            setSelectionAtTextOffset(0, "collapsed");
          });
          const nextSnapshot = readSnapshot(editor);
          snapshotRef.current = nextSnapshot;
          onChangeRef.current("", 0, 0, false);
        },
        focusAt: (cursor: number) => {
          focusAtRef.current(cursor);
        },
        focusAtEnd: () => {
          focusAtRef.current(
            collapseExpandedComposerCursor(
              snapshotRef.current.value,
              snapshotRef.current.value.length,
            ),
          );
        },
        insertText: (text: string) => {
          insertTextRef.current(text);
        },
        insertMention: (payload: ComposerMentionPayload) => {
          insertMentionRef.current(payload);
        },
        getText: () => readSnapshot(editor).value,
        getCommands: () => collectCommands(editor),
        getMentions: () => collectMentions(editor),
        getSubmitData: () => {
          const snapshot = readSnapshot(editor);
          return {
            text: snapshot.value,
            richText: readRichText(editor.getEditorState()),
            commands: collectCommands(editor),
            mentions: collectMentions(editor),
          };
        },
        readSnapshot: () => readSnapshot(editor),
        editor,
      }),
      [editor],
    );

    return (
      <div ref={hotkeyTargetRef} className="relative w-full min-w-0" data-prompt-editor-root="true">
        <PromptEditorEditableSync key={String(disabled)} disabled={disabled} editor={editor} />
        <OnChangePlugin
          ignoreHistoryMergeTagChange
          ignoreSelectionChange={false}
          onChange={emitSnapshot}
        />
        <PlainTextPlugin
          ErrorBoundary={LexicalErrorBoundary}
          contentEditable={
            <ContentEditable
              aria-label={placeholder}
              className={cn(
                "block w-full whitespace-pre-wrap break-words outline-hidden",
                className,
              )}
              data-prompt-editor-input="true"
              data-testid="composer-editor"
              onBeforeInput={handleBeforeInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={null}
              spellCheck
              tabIndex={-1}
            />
          }
          placeholder={<PromptEditorPlaceholder className={className} placeholder={placeholder} />}
        />
        <span
          ref={setCaretAnchor}
          aria-hidden="true"
          data-composer-menu-anchor=""
          className="pointer-events-none absolute h-px w-px"
          style={{ left: 0, top: 0 }}
        />
      </div>
    );
  },
);

const PromptEditorPlaceholder = function PromptEditorPlaceholder({
  className,
  placeholder,
}: {
  className: string | undefined;
  placeholder: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("block w-full whitespace-pre-wrap break-words", className)}
      data-prompt-editor-placeholder=""
    >
      {placeholder}
    </div>
  );
};

function PromptEditorEditableSync({
  disabled,
  editor,
}: {
  disabled: boolean;
  editor: LexicalEditor;
}) {
  useMountEffect(() => {
    editor.setEditable(!disabled);
  });

  return null;
}
