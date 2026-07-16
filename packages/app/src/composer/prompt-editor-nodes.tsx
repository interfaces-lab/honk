import * as stylex from "@stylexjs/stylex";
import { Icon, Tooltip } from "@honk/ui";
import { IconFileBend } from "@honk/ui/icons";
import { colorVars, controlVars, fontVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import {
  $applyNodeReplacement,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  DecoratorNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";
import * as React from "react";

const styles = stylex.create({
  mentionChip: { display: "inline-flex", alignItems: "center", gap: controlVars["--honk-control-gap"], height: "22px", maxWidth: "240px", paddingInline: "5px", borderRadius: radiusVars["--honk-radius-pill"], backgroundColor: colorVars["--honk-color-control"] },
  mentionChipLabel: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  commandChip: { display: "inline-flex", alignItems: "center", height: "22px", paddingInline: "5px", borderRadius: radiusVars["--honk-radius-pill"], backgroundColor: colorVars["--honk-color-control"], fontFamily: fontVars["--honk-font-family-mono"] },
  commandTooltip: { display: "flex", flexDirection: "column", gap: spaceVars["--honk-space-gutter"], maxWidth: "240px" },
  commandTooltipTitle: { fontWeight: 600 },
  commandTooltipBody: { color: colorVars["--honk-color-text-muted"] },
});

export type MentionPayload = {
  readonly path: string;
  readonly label: string;
  readonly mime?: string;
};

type SerializedMentionNode = SerializedLexicalNode & MentionPayload;

function MentionChip({ path, label }: MentionPayload): React.ReactElement {
  return (
    <Tooltip label={path}>
      <span {...stylex.props(styles.mentionChip)} contentEditable={false} data-mention="">
        <Icon icon={IconFileBend} size="sm" tone="muted" />
        <span {...stylex.props(styles.mentionChipLabel)}>{label}</span>
      </span>
    </Tooltip>
  );
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
      ...(node.mime !== undefined ? { mime: node.mime } : {}),
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
    const element = document.createElement("span");
    element.style.display = "inline-flex";
    element.style.verticalAlign = "middle";
    return element;
  }

  override updateDOM(): false {
    return false;
  }

  override decorate(): React.ReactElement {
    return <MentionChip {...this.__payload} />;
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

export function isComposerMentionNode(node: LexicalNode | null | undefined): node is ComposerMentionNode {
  return node instanceof ComposerMentionNode;
}

// Render a slash command as a token. Serialization returns /name so submission can run it.

type CommandPayload = {
  readonly name: string;
  readonly description: string | null;
};

type SerializedCommandNode = SerializedLexicalNode & CommandPayload;

// OpenCode commands have no display title. Convert the command name into a tooltip title.
function commandTitle(name: string): string {
  return name.length === 0 ? name : `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

function CommandChip({ name, description }: CommandPayload): React.ReactElement {
  const token = (
    <span {...stylex.props(styles.commandChip)} contentEditable={false} data-command="">
      {`/${name}`}
    </span>
  );
  if (description === null) {
    return <Tooltip label={commandTitle(name)}>{token}</Tooltip>;
  }
  return (
    <Tooltip
      label={
        <span {...stylex.props(styles.commandTooltip)}>
          <span {...stylex.props(styles.commandTooltipTitle)}>{commandTitle(name)}</span>
          <span {...stylex.props(styles.commandTooltipBody)}>{description}</span>
        </span>
      }
    >
      {token}
    </Tooltip>
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
    return new ComposerCommandNode({ name: node.name, description: node.description });
  }

  constructor(payload: CommandPayload, key?: NodeKey) {
    super(key);
    this.__payload = payload;
  }

  override exportJSON(): SerializedCommandNode {
    return { type: "composerCommand", version: 1, ...this.__payload };
  }

  getCommandName(): string {
    return this.getLatest().__payload.name;
  }

  override createDOM(): HTMLElement {
    const element = document.createElement("span");
    element.style.display = "inline";
    element.style.verticalAlign = "baseline";
    return element;
  }

  override updateDOM(): false {
    return false;
  }

  override decorate(): React.ReactElement {
    return <CommandChip {...this.__payload} />;
  }

  override getTextContent(): string {
    return `/${this.__payload.name}`;
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

export function isComposerCommandNode(node: LexicalNode | null | undefined): node is ComposerCommandNode {
  return node instanceof ComposerCommandNode;
}

// Convert the editor document into prompt text and file mentions for OpenCode.
function serializeNode(node: LexicalNode, mentions: MentionPayload[]): string {
  if (isComposerMentionNode(node)) {
    const payload = node.getPayload();
    mentions.push(payload);
    return `@${payload.path}`;
  }
  if (isComposerCommandNode(node)) {
    return `/${node.getCommandName()}`;
  }
  if ($isTextNode(node)) {
    return node.getTextContent();
  }
  if ($isLineBreakNode(node)) {
    return "\n";
  }
  if ($isElementNode(node)) {
    return node
      .getChildren()
      .map((child) => serializeNode(child, mentions))
      .join("");
  }
  return node.getTextContent();
}

export function serializePrompt(editor: LexicalEditor): {
  readonly text: string;
  readonly mentions: readonly MentionPayload[];
} {
  const mentions: MentionPayload[] = [];
  let text = "";
  editor.getEditorState().read(() => {
    $getRoot()
      .getChildren()
      .forEach((block, index) => {
        if (index > 0) {
          text += "\n";
        }
        text += serializeNode(block, mentions);
      });
  });
  return { text, mentions };
}
