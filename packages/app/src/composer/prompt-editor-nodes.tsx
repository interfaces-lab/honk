import * as stylex from "@stylexjs/stylex";
import {
  IconBranch,
  IconBubble2,
  IconBuildingBlocks,
  IconConsoleSimple,
  IconFolder1,
  IconGlobe,
} from "@honk/ui/icons";
import { colorVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";
import {
  $applyNodeReplacement,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  DELETE_CHARACTER_COMMAND,
  DecoratorNode,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type Point,
  type SerializedLexicalNode,
} from "lexical";
import * as React from "react";

import { Chip, ChipIcon, chipStyles, FileChipIcon } from "./chip";
import { formatSkillReference } from "./submission";

function createChipHost(): HTMLElement {
  const element = document.createElement("span");
  element.contentEditable = "false";
  element.style.display = "inline";
  return element;
}

const styles = stylex.create({
  commandTooltip: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
  },
  commandTooltipTitle: { fontWeight: fontVars["--honk-font-weight-semibold"] },
  commandTooltipBody: { color: colorVars["--honk-color-text-muted"] },
});

type MentionKind = "browser" | "file" | "folder";

export type MentionPayload = {
  readonly path: string;
  readonly label: string;
  readonly kind?: MentionKind;
  readonly mime?: string;
};

export type SerializedMention = MentionPayload & {
  readonly source: {
    readonly text: string;
    readonly start: number;
    readonly end: number;
  };
};

type SerializedMentionNode = SerializedLexicalNode & MentionPayload;

export function MentionChipIcon({
  kind = "file",
  path,
}: {
  readonly kind?: MentionKind | undefined;
  readonly path: string;
}): React.ReactElement {
  if (kind === "browser") return <ChipIcon icon={IconGlobe} />;
  if (kind === "folder") return <ChipIcon icon={IconFolder1} />;
  return <FileChipIcon path={path} />;
}

function MentionChip(props: MentionPayload & { readonly nodeKey: NodeKey }): React.ReactElement {
  const [isSelected] = useLexicalNodeSelection(props.nodeKey);
  const [editor] = useLexicalComposerContext();
  return (
    <Chip
      tooltip={props.path}
      label={props.label}
      isSelected={isSelected}
      icon={
        <MentionChipIcon
          path={props.path}
          {...(props.kind === undefined ? {} : { kind: props.kind })}
        />
      }
      onRemove={() => {
        removeChip(editor, props.nodeKey);
      }}
    />
  );
}

// The click path and the Backspace path have to agree, or the separator survives one of them.
export function removeChip(editor: LexicalEditor, nodeKey: NodeKey): void {
  editor.update(() => {
    const node = $getNodeByKey(nodeKey);
    if (isComposerChipNode(node)) $removeChipWithSeparator(node);
  });
  editor.focus();
}

export class ComposerMentionNode extends DecoratorNode<React.ReactElement> {
  readonly __payload: MentionPayload;

  static override getType(): string {
    return "composerMention";
  }

  static override clone(node: ComposerMentionNode): ComposerMentionNode {
    return new ComposerMentionNode(node.__payload, node.__key);
  }

  static override importJSON(serialized: SerializedLexicalNode): ComposerMentionNode {
    const node = serialized as SerializedMentionNode;
    return new ComposerMentionNode({
      path: node.path,
      label: node.label,
      ...(node.kind === undefined ? {} : { kind: node.kind }),
      ...(node.mime === undefined ? {} : { mime: node.mime }),
    });
  }

  constructor(payload: MentionPayload, key?: NodeKey) {
    super(key);
    this.__payload = payload;
  }

  override exportJSON(): SerializedMentionNode {
    return { type: "composerMention", version: 1, ...this.__payload };
  }

  getPayload(): MentionPayload {
    return this.getLatest().__payload;
  }

  override createDOM(): HTMLElement {
    return createChipHost();
  }

  override updateDOM(): false {
    return false;
  }

  override decorate(): React.ReactElement {
    return <MentionChip {...this.__payload} nodeKey={this.__key} />;
  }

  override getTextContent(): string {
    return `@${this.__payload.path}`;
  }

  override isInline(): true {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return true;
  }
}

export function $createMentionNode(payload: MentionPayload): ComposerMentionNode {
  return $applyNodeReplacement(new ComposerMentionNode(payload));
}

export function isComposerMentionNode(
  node: LexicalNode | null | undefined,
): node is ComposerMentionNode {
  return node instanceof ComposerMentionNode;
}

// Commands serialize to /name; skills serialize to a `[name][path]` pointer so the body never
// expands inline.
type CommandPayload = {
  readonly name: string;
  readonly description: string | null;
  readonly path: string | null;
};

function commandReferenceText(payload: CommandPayload): string {
  return payload.path === null
    ? `/${payload.name}`
    : formatSkillReference(payload.name, payload.path);
}

type SerializedCommandNode = SerializedLexicalNode & CommandPayload;

function commandTitle(name: string): string {
  return name.length === 0 ? name : `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

function CommandChip(props: CommandPayload & { readonly nodeKey: NodeKey }): React.ReactElement {
  const [isSelected] = useLexicalNodeSelection(props.nodeKey);
  const [editor] = useLexicalComposerContext();
  return (
    <Chip
      tooltip={
        props.description === null ? (
          commandTitle(props.name)
        ) : (
          <span {...stylex.props(styles.commandTooltip, chipStyles.width)}>
            <span {...stylex.props(styles.commandTooltipTitle)}>{commandTitle(props.name)}</span>
            <span {...stylex.props(styles.commandTooltipBody)}>{props.description}</span>
          </span>
        )
      }
      label={`/${props.name}`}
      isSelected={isSelected}
      icon={<ChipIcon icon={props.path === null ? IconConsoleSimple : IconBuildingBlocks} />}
      onRemove={() => {
        removeChip(editor, props.nodeKey);
      }}
    />
  );
}

export class ComposerCommandNode extends DecoratorNode<React.ReactElement> {
  readonly __payload: CommandPayload;

  static override getType(): string {
    return "composerCommand";
  }

  static override clone(node: ComposerCommandNode): ComposerCommandNode {
    return new ComposerCommandNode(node.__payload, node.__key);
  }

  static override importJSON(serialized: SerializedLexicalNode): ComposerCommandNode {
    const node = serialized as SerializedCommandNode;
    return new ComposerCommandNode({
      name: node.name,
      description: node.description,
      path: node.path ?? null,
    });
  }

  constructor(payload: CommandPayload, key?: NodeKey) {
    super(key);
    this.__payload = payload;
  }

  override exportJSON(): SerializedCommandNode {
    return { type: "composerCommand", version: 1, ...this.__payload };
  }

  override createDOM(): HTMLElement {
    return createChipHost();
  }

  override updateDOM(): false {
    return false;
  }

  override decorate(): React.ReactElement {
    return <CommandChip {...this.__payload} nodeKey={this.__key} />;
  }

  override getTextContent(): string {
    return commandReferenceText(this.getLatest().__payload);
  }

  override isInline(): true {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return true;
  }
}

export function $createCommandNode(payload: CommandPayload): ComposerCommandNode {
  return $applyNodeReplacement(new ComposerCommandNode(payload));
}

export function isComposerCommandNode(
  node: LexicalNode | null | undefined,
): node is ComposerCommandNode {
  return node instanceof ComposerCommandNode;
}

export type ContextKind = "branch" | "chat";

export type ContextPayload = {
  readonly kind: ContextKind;
  readonly sourceKey: string;
  readonly label: string;
  readonly path: string | null;
  readonly mime: string;
};

type SerializedContextNode = SerializedLexicalNode & ContextPayload;

function ContextChip(props: ContextPayload & { readonly nodeKey: NodeKey }): React.ReactElement {
  const [isSelected] = useLexicalNodeSelection(props.nodeKey);
  const [editor] = useLexicalComposerContext();
  return (
    <Chip
      tooltip={props.kind === "chat" ? "Past chat" : "Current branch diff"}
      label={props.label}
      isSelected={isSelected}
      icon={<ChipIcon icon={props.kind === "chat" ? IconBubble2 : IconBranch} />}
      onRemove={() => {
        removeChip(editor, props.nodeKey);
      }}
    />
  );
}

export class ComposerContextNode extends DecoratorNode<React.ReactElement> {
  __payload: ContextPayload;

  static override getType(): string {
    return "composerContext";
  }

  static override clone(node: ComposerContextNode): ComposerContextNode {
    return new ComposerContextNode(node.__payload, node.__key);
  }

  static override importJSON(serialized: SerializedLexicalNode): ComposerContextNode {
    const node = serialized as SerializedContextNode;
    return new ComposerContextNode({
      kind: node.kind,
      sourceKey: node.sourceKey,
      label: node.label,
      path: node.path,
      mime: node.mime,
    });
  }

  constructor(payload: ContextPayload, key?: NodeKey) {
    super(key);
    this.__payload = payload;
  }

  override exportJSON(): SerializedContextNode {
    return { type: "composerContext", version: 1, ...this.__payload };
  }

  getPayload(): ContextPayload {
    return this.getLatest().__payload;
  }

  setPath(path: string): void {
    const writable = this.getWritable();
    writable.__payload = { ...writable.__payload, path };
  }

  override createDOM(): HTMLElement {
    return createChipHost();
  }

  override updateDOM(): false {
    return false;
  }

  override decorate(): React.ReactElement {
    return <ContextChip {...this.__payload} nodeKey={this.__key} />;
  }

  override getTextContent(): string {
    return `@${this.__payload.label}`;
  }

  override isInline(): true {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return true;
  }
}

export function $createContextNode(payload: ContextPayload): ComposerContextNode {
  return $applyNodeReplacement(new ComposerContextNode(payload));
}

export function isComposerContextNode(
  node: LexicalNode | null | undefined,
): node is ComposerContextNode {
  return node instanceof ComposerContextNode;
}

type ComposerChipNode = ComposerCommandNode | ComposerContextNode | ComposerMentionNode;

export function isComposerChipNode(node: LexicalNode | null | undefined): node is ComposerChipNode {
  return isComposerMentionNode(node) || isComposerCommandNode(node) || isComposerContextNode(node);
}

// Every chip is inserted with a trailing space so the caret has somewhere to land beside it. That
// separator belongs to the chip and has to leave with it: Lexical's own deleteCharacter drops the
// decorator and keeps the text node, so editing a prompt otherwise collects a widening gap at every
// mention the user removes.
export function registerChipDeletion(editor: LexicalEditor): () => void {
  // Command listeners already run inside a writable update, so this mutates the selection directly.
  // A nested editor.update() would be queued behind the current one and its result read too late to
  // claim the keystroke, leaving the browser to delete on top of the removal.
  const deleteSelectedChips = (event: KeyboardEvent): boolean => {
    if (event.isComposing) return false;
    const selection = $getSelection();
    if (!$isNodeSelection(selection)) return false;
    const nodes = selection.getNodes();
    // A mixed selection is still Lexical's to delete; only a pure chip selection is ours.
    if (nodes.length === 0 || !nodes.every(isComposerChipNode)) return false;
    nodes.forEach($removeChipWithSeparator);
    // Without this the browser still applies its own deleteContentBackward.
    event.preventDefault();
    return true;
  };
  return mergeRegister(
    editor.registerCommand(KEY_BACKSPACE_COMMAND, deleteSelectedChips, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(KEY_DELETE_COMMAND, deleteSelectedChips, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(
      DELETE_CHARACTER_COMMAND,
      $deleteChipAtRangeSelection,
      COMMAND_PRIORITY_HIGH,
    ),
  );
}

// Returns false when the deletion is not ours, leaving Lexical its default handling.
function $deleteChipAtRangeSelection(isBackward: boolean): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  if (!selection.isCollapsed()) {
    selection.getNodes().filter(isComposerChipNode).forEach($removeChipSeparator);
    return false;
  }
  const chip = $chipBesideCaret(selection.anchor, isBackward);
  if (chip === null) return false;
  $removeChipWithSeparator(chip);
  return true;
}

function $chipBesideCaret(anchor: Point, isBackward: boolean): ComposerChipNode | null {
  const node = anchor.getNode();
  if ($isElementNode(node)) {
    const child = node.getChildAtIndex(isBackward ? anchor.offset - 1 : anchor.offset);
    return isComposerChipNode(child) ? child : null;
  }
  if (!$isTextNode(node)) return null;
  // Only a caret pressed against the chip deletes it; mid-text the keystroke is an ordinary edit.
  if (anchor.offset !== (isBackward ? 0 : node.getTextContentSize())) return null;
  const sibling = isBackward ? node.getPreviousSibling() : node.getNextSibling();
  return isComposerChipNode(sibling) ? sibling : null;
}

function $removeChipWithSeparator(node: ComposerChipNode): void {
  $removeChipSeparator(node);
  node.remove();
}

function $removeChipSeparator(node: ComposerChipNode): void {
  const separator = node.getNextSibling();
  if (!$isTextNode(separator) || !separator.getTextContent().startsWith(" ")) return;
  if (separator.getTextContentSize() === 1) {
    separator.remove();
    return;
  }
  // splitText updates RangeSelection points that refer to the shortened node. setTextContent does
  // not, which can leave click-to-remove with an offset beyond the remaining text.
  separator.splitText(1)[0]?.remove();
}

function serializeNode(
  node: LexicalNode,
  state: {
    text: string;
    readonly mentions: SerializedMention[];
    readonly contexts: ContextPayload[];
  },
): void {
  if (isComposerMentionNode(node)) {
    const payload = node.getPayload();
    const text = `@${payload.path}`;
    if ((payload.kind ?? "file") === "file") {
      state.mentions.push({
        ...payload,
        source: { text, start: state.text.length, end: state.text.length + text.length },
      });
    }
    state.text += text;
    return;
  }
  if (isComposerCommandNode(node)) {
    state.text += node.getTextContent();
    return;
  }
  if (isComposerContextNode(node)) {
    state.contexts.push(node.getPayload());
    state.text += node.getTextContent();
    return;
  }
  if ($isTextNode(node) || $isLineBreakNode(node)) {
    state.text += node.getTextContent();
    return;
  }
  if ($isElementNode(node)) {
    node.getChildren().forEach((child) => {
      serializeNode(child, state);
    });
    return;
  }
  state.text += node.getTextContent();
}

export function serializePrompt(editor: LexicalEditor): {
  readonly text: string;
  readonly mentions: readonly SerializedMention[];
  readonly contexts: readonly ContextPayload[];
} {
  const state: {
    text: string;
    readonly mentions: SerializedMention[];
    readonly contexts: ContextPayload[];
  } = { text: "", mentions: [], contexts: [] };
  editor.getEditorState().read(() => {
    $getRoot()
      .getChildren()
      .forEach((block, index) => {
        if (index > 0) state.text += "\n";
        serializeNode(block, state);
      });
  });
  return state;
}
