// The composer — the shipped app's compact input anatomy over the opencode v2 send path:
// rounded editor card, thumbnail attachments, footer attachment/mode/model controls, and a
// primary send action. The model selector changes the four app-next preset bundles before
// thread birth; a thread keeps the selected bundle pinned after creation.
//
// 2026-07-12: the old composer's menus are BACK, rebuilt on the sidecar seams —
//   "/" anywhere (word start)       → the slash-command menu (client.command.list; selecting
//                                     rewrites the typed /token in place; a LEADING /token still
//                                     routes the send through session.command on submit)
//   "@" anywhere                    → the file-mention menu (client.find.files; selecting
//                                     inserts @path and attaches a FilePartInput on send)
// plus the LOCATION CHIP in the footer: where the new thread will live. Home's project
// selection feeds it; clicking it opens the OS folder picker (desktop bridge) to aim the
// thread anywhere else. The shared PromptEditor also serves the thread composer.

import * as stylex from "@stylexjs/stylex";
import { Button, Icon, IconButton, Menu, Tooltip } from "@honk/ui";
import {
  IconArrowUp,
  IconBubbleQuestion,
  IconCheckmark1,
  IconChevronDownMedium,
  IconClawd,
  IconCrossSmall,
  IconFileBend,
  IconFolder1,
  IconOpenaiCodex,
  IconPlusSmall,
} from "@honk/ui/icons";
import {
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  radiusVars,
  spaceVars,
  zVars,
} from "@honk/ui/tokens.stylex";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { mergeRegister } from "@lexical/utils";
import {
  $applyNodeReplacement,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  DecoratorNode,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";
import * as React from "react";

import { actions as appSettingsActions } from "./app-settings-store";
import { pickFolder } from "./desktop-bridge";
import {
  actions as modeActions,
  DEFAULT_MODE,
  modeAgentName,
  modeById,
  nextModeId,
  useHomeMode,
  type ModeId,
} from "./modes";
import {
  actions as presetActions,
  PRESETS,
  presetById,
  useSelectedPreset,
  type PresetDefinition,
} from "./presets";
import type { SendMessageFile, SidecarCommand } from "./sidecar";
import { actions as tabActions } from "./tab-store";
import { getBoundHonkClient } from "./watch-registry";

// opencode composer geometry (prompt-input.tsx 1617/1659/1696) — one-component structure,
// named at the top per the home-page idiom.
const CARD_MIN_HEIGHT = "96px";
const EDITOR_MIN_HEIGHT = "52px";
const EDITOR_MAX_HEIGHT = "180px";
const EDITOR_PAD_X = "16px";
const EDITOR_PAD_TOP = "16px";
const EDITOR_PAD_BOTTOM = "8px";
const EDITOR_LEADING = "20px";
const FOOTER_HEIGHT = "44px";
// The menu popup: floats above the editor card, capped before it covers the tab strip.
const MENU_MAX_HEIGHT = "240px";
const MENU_ROW_HEIGHT = "28px";
const MENU_FINE_GAP = "1px";
const MENU_PAD = "4px";
const MENU_GUTTER = "6px";
// File-search debounce — long enough to coalesce a burst of keystrokes, short enough to feel live.
const FILE_SEARCH_DEBOUNCE_MS = 120;
const MENU_MAX_ITEMS = 32;
// The old composer attachment tile is a fixed 56px square; it is component anatomy rather than
// a theme value, so it stays a named intrinsic while its colors/radius come from tokens.
const ATTACHMENT_SIZE = "56px";
const ATTACHMENT_ACTION_INSET = "4px";
const ATTACHMENT_ACTION_SIZE = "20px";
const ATTACHMENT_RING = `inset 0 0 0 1px ${colorVars["--honk-color-border-base"]}`;
const MODEL_MENU_WIDTH = "280px";
// The gap between a preset row's two lines (the label line and the muted Agent · Oracle line).
const PRESET_ROW_GAP = "2px";
const CHIP_HEIGHT = "22px";
const CHIP_TRAILING_PAD = "2px";
const CHIP_ACTION_SIZE = "16px";
const CHIP_MAX_WIDTH = "240px";
const LOCATION_MAX_WIDTH = "220px";
// The inline @-mention chip (a Lexical decorator node) — tight chip anatomy, named intrinsics.
const MENTION_CHIP_GAP = "4px";
const MENTION_CHIP_PAD_X = "5px";

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
  },
  card: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minHeight: CARD_MIN_HEIGHT,
    backgroundColor: colorVars["--honk-color-bg-base"],
    // The composer is the one card on the flat main frame — its corner matches the sheet's panel
    // radius (10px) so a card never rounds harder than the surface it floats on.
    borderRadius: radiusVars["--honk-radius-panel"],
    boxShadow: elevationVars["--honk-elevation-raised"],
  },
  editorBlock: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
  },
  hiddenInput: {
    display: "none",
  },
  // The Lexical contenteditable surface (a <div>, not a textarea): grows with content up to the
  // ceiling, wraps long lines, and hosts inline mention chips.
  editor: {
    width: "100%",
    boxSizing: "border-box",
    minHeight: EDITOR_MIN_HEIGHT,
    maxHeight: EDITOR_MAX_HEIGHT,
    paddingInline: EDITOR_PAD_X,
    paddingTop: EDITOR_PAD_TOP,
    paddingBottom: EDITOR_PAD_BOTTOM,
    margin: 0,
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-book"],
    lineHeight: EDITOR_LEADING,
    overflowY: "auto",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    cursor: "text",
  },
  // Wraps the contenteditable so the empty-state placeholder can overlay it from the editor's own
  // top-left (not the whole card, which also holds attachment tiles).
  editorShell: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  },
  // The empty-state placeholder — a non-interactive overlay at the editor's text origin.
  editorPlaceholder: {
    position: "absolute",
    insetInlineStart: EDITOR_PAD_X,
    insetBlockStart: EDITOR_PAD_TOP,
    pointerEvents: "none",
    userSelect: "none",
    color: colorVars["--honk-color-text-faint"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: EDITOR_LEADING,
  },
  // The inline @-mention chip rendered by ComposerMentionNode: a file glyph + basename, the full
  // path on hover. Neutral layer fill so it reads as a token without stealing the accent.
  mentionChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: MENTION_CHIP_GAP,
    verticalAlign: "middle",
    maxWidth: CHIP_MAX_WIDTH,
    paddingInline: MENTION_CHIP_PAD_X,
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: colorVars["--honk-color-layer-02"],
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
    userSelect: "none",
    cursor: "default",
  },
  mentionChipLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // The inline slash-command token (a Lexical decorator node) — the picked command rendered as
  // amber `/name` in the editor's own font, with the command's name + description on hover. It's the
  // warn hue (not the blue accent) so a command reads as a distinct "run this" token, not a link.
  commandChip: {
    color: colorVars["--honk-color-warn-fg"],
    fontFamily: "inherit",
    fontSize: "inherit",
    fontWeight: fontVars["--honk-font-weight-medium"],
    whiteSpace: "nowrap",
    userSelect: "none",
    cursor: "default",
  },
  // The command tooltip's rich label: a bold titleized name over the muted description (the shipped
  // composer's command tooltip anatomy — see the reference in packages/app's ComposerCommandChip).
  commandTooltip: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    maxWidth: CHIP_MAX_WIDTH,
  },
  commandTooltipTitle: {
    color: colorVars["--honk-color-text-primary"],
    fontWeight: fontVars["--honk-font-weight-medium"],
  },
  commandTooltipBody: {
    color: colorVars["--honk-color-text-muted"],
  },
  // Video attachments preview their first frame in the same 56px tile as images.
  attachmentVideo: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  // ── The trigger menu (files / slash commands) ─────────────────────────────────────────────
  // Placement flips per surface: the home composer sits near the sheet top (menu opens BELOW,
  // or it clips at the window edge); the thread composer sits at the bottom (menu opens ABOVE).
  menu: {
    position: "absolute",
    insetInline: spaceVars["--honk-space-gutter"],
    zIndex: zVars["--honk-z-stage-float"],
    display: "flex",
    flexDirection: "column",
    gap: MENU_FINE_GAP,
    maxHeight: MENU_MAX_HEIGHT,
    overflowY: "auto",
    padding: MENU_PAD,
    boxSizing: "border-box",
    backgroundColor: colorVars["--honk-color-bg-base"],
    borderRadius: radiusVars["--honk-radius-panel"],
    boxShadow: elevationVars["--honk-elevation-floating"],
  },
  menuAbove: {
    bottom: "100%",
    marginBottom: MENU_GUTTER,
  },
  menuBelow: {
    top: "100%",
    marginTop: MENU_GUTTER,
  },
  menuRow: {
    flexShrink: 0,
    height: MENU_ROW_HEIGHT,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-gutter"],
    borderRadius: radiusVars["--honk-radius-control"],
    borderWidth: 0,
    backgroundColor: "transparent",
    textAlign: "left",
    cursor: "default",
    fontFamily: "inherit",
    fontSize: fontVars["--honk-font-size-body"],
    color: colorVars["--honk-color-text-primary"],
    minWidth: 0,
  },
  menuRowSelected: {
    backgroundColor: colorVars["--honk-color-layer-02"],
  },
  menuRowTitle: {
    flexShrink: 0,
    whiteSpace: "nowrap",
  },
  menuRowDetail: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-faint"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  menuEmpty: {
    height: MENU_ROW_HEIGHT,
    display: "flex",
    alignItems: "center",
    paddingInline: spaceVars["--honk-space-gutter"],
    color: colorVars["--honk-color-text-faint"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  // ── Attachments ──────────────────────────────────────────────────────────────────────────
  // Uploaded images use the old composer's 56px thumbnail tile. Project-file mentions keep the
  // compact chip because a path is more useful than an invented thumbnail for a source file.
  attachmentGroup: {
    display: "flex",
    flexWrap: "wrap",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: EDITOR_PAD_X,
    paddingTop: spaceVars["--honk-space-gutter"],
  },
  attachment: {
    position: "relative",
    width: ATTACHMENT_SIZE,
    height: ATTACHMENT_SIZE,
    flexShrink: 0,
    overflow: "hidden",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    boxShadow: ATTACHMENT_RING,
  },
  attachmentImage: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  attachmentFallback: {
    display: "flex",
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    padding: spaceVars["--honk-space-control-pad-x"],
    color: colorVars["--honk-color-text-faint"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-caption"],
    textAlign: "center",
    overflow: "hidden",
  },
  attachmentAction: {
    position: "absolute",
    top: ATTACHMENT_ACTION_INSET,
    right: ATTACHMENT_ACTION_INSET,
    width: ATTACHMENT_ACTION_SIZE,
    height: ATTACHMENT_ACTION_SIZE,
    minWidth: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: {
      default: colorVars["--honk-color-bg-base"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-control-hover"] },
    },
    color: colorVars["--honk-color-text-primary"],
    boxShadow: ATTACHMENT_RING,
    cursor: "pointer",
  },
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: controlVars["--honk-control-gap"],
    paddingInline: EDITOR_PAD_X,
    paddingTop: spaceVars["--honk-space-gutter"],
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    height: CHIP_HEIGHT,
    paddingLeft: spaceVars["--honk-space-gutter"],
    paddingRight: CHIP_TRAILING_PAD,
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    boxShadow: ATTACHMENT_RING,
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-detail"],
    fontFamily: fontVars["--honk-font-family-mono"],
    maxWidth: CHIP_MAX_WIDTH,
  },
  chipLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chipRemove: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: CHIP_ACTION_SIZE,
    height: CHIP_ACTION_SIZE,
    padding: 0,
    borderWidth: 0,
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-layer-02"] },
    },
    color: "inherit",
    cursor: "default",
  },
  footer: {
    height: FOOTER_HEIGHT,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingInline: EDITOR_PAD_X,
  },
  footerSpacer: {
    flexGrow: 1,
  },
  attachmentButton: {
    borderRadius: radiusVars["--honk-radius-pill"],
    color: colorVars["--honk-color-text-faint"],
  },
  // The location chip — where this thread will live; click re-aims it via the OS picker.
  locationChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    height: controlVars["--honk-control-h-sm"],
    paddingInline: spaceVars["--honk-space-gutter"],
    borderWidth: 0,
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-layer-01"] },
    },
    color: {
      default: colorVars["--honk-color-text-faint"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
    },
    fontSize: fontVars["--honk-font-size-detail"],
    cursor: "default",
    maxWidth: LOCATION_MAX_WIDTH,
  },
  locationLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // Shared pill radius for the footer's chip controls (mode, preset, send) so the row reads as one
  // family instead of a mix of pills and 6px rectangles.
  footerPill: {
    borderRadius: radiusVars["--honk-radius-pill"],
  },
  modelMenu: {
    width: MODEL_MENU_WIDTH,
    maxWidth: MODEL_MENU_WIDTH,
  },
  // A preset row: a flat two-line row (label + variant, then the pinned Agent · Oracle models) — no
  // nested hover submenu, no "Use X" action. Overrides the menu item's fixed single-line height.
  presetRow: {
    height: "auto",
    flexDirection: "column",
    alignItems: "stretch",
    gap: PRESET_ROW_GAP,
    paddingBlock: controlVars["--honk-control-pad-sm"],
  },
  presetRowTop: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
  presetLabel: {
    flexGrow: 1,
    color: colorVars["--honk-color-text-primary"],
    fontWeight: fontVars["--honk-font-weight-medium"],
  },
  presetVariant: {
    color: colorVars["--honk-color-text-faint"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  presetSub: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-faint"],
    fontSize: fontVars["--honk-font-size-caption"],
  },
});

// ── Trigger parsing ──────────────────────────────────────────────────────────────────────────

type MenuTrigger = {
  readonly kind: "file" | "command";
  readonly query: string;
  // Replace-range of the token (including its @ / /) when a row is applied.
  readonly start: number;
  readonly end: number;
};

type MenuItem = {
  readonly key: string;
  readonly title: string;
  readonly detail: string | null;
  readonly mention?: MentionPayload;
};

// ── Attachments ──────────────────────────────────────────────────────────────────────────────
// Two births: an @-mention (path into the project, mime sniffed from the extension) and a
// pasted/dropped file (bytes in hand → a data: URL with the file's real mime — the photo-upload
// path; there is no separate upload endpoint, opencode reads data: parts directly).

type Attachment = {
  // Stable identity for the chip list (a path, or a synthetic paste key).
  readonly key: string;
  // What the chip prints.
  readonly label: string;
  // What the sidecar sends: a project path, or a data:/file: url.
  readonly path: string;
  readonly mime?: string;
};

const EXTENSION_MIME: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  pdf: "application/pdf",
  // Video + audio — the composer accepts more than photos (paste/drop/pick a clip or a voice memo).
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
};

function mimeFromPath(path: string): string | undefined {
  const dot = path.lastIndexOf(".");
  if (dot === -1) {
    return undefined;
  }
  return EXTENSION_MIME[path.slice(dot + 1).toLowerCase()];
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = () => {
      reject(new Error(`Failed to read ${file.name}`));
    };
    reader.readAsDataURL(file);
  });
}

// ── The shared prompt editor (home + thread composers) ──────────────────────────────────────

type PromptSubmit = {
  readonly text: string;
  readonly files: readonly SendMessageFile[];
  readonly sideChatIds: readonly string[];
  // Set when the prompt is a known slash command — the caller routes via runCommand.
  readonly command: { readonly name: string; readonly arguments: string } | null;
};

type SideChatMention = {
  readonly id: string;
  readonly title: string;
};

type PromptEditorHandle = {
  readonly submit: () => void;
  readonly focus: () => void;
  readonly chooseImages: () => void;
};

// ── The @-mention chip (a Lexical decorator node) ────────────────────────────────────────────
// Selecting a file from the @ menu drops one of these inline: a file glyph + the basename, with
// the full project path on hover. It carries the path so the editor serializes it back to `@path`
// on submit and attaches the file part — the app-next port of the old composer's mention chip.

type MentionPayload = {
  readonly path: string;
  readonly label: string;
  readonly mime?: string;
  readonly sideChatId?: string;
};

type SerializedMentionNode = SerializedLexicalNode & MentionPayload;

function MentionChip({ path, label, sideChatId }: MentionPayload): React.ReactElement {
  return (
    <Tooltip label={sideChatId === undefined ? path : `Side chat · ${label}`}>
      <span {...stylex.props(styles.mentionChip)} contentEditable={false} data-mention="">
        <Icon
          icon={sideChatId === undefined ? IconFileBend : IconBubbleQuestion}
          size="sm"
          tone="muted"
        />
        <span {...stylex.props(styles.mentionChipLabel)}>{label}</span>
      </span>
    </Tooltip>
  );
}

class ComposerMentionNode extends DecoratorNode<React.ReactElement> {
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
      ...(node.sideChatId !== undefined ? { sideChatId: node.sideChatId } : {}),
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
    return `@${
      this.__payload.sideChatId === undefined ? this.__payload.path : this.__payload.label
    }`;
  }

  override isInline(): true {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return true;
  }
}

function $createMentionNode(payload: MentionPayload): ComposerMentionNode {
  return $applyNodeReplacement(new ComposerMentionNode(payload));
}

function isComposerMentionNode(node: LexicalNode | null | undefined): node is ComposerMentionNode {
  return node instanceof ComposerMentionNode;
}

// ── The slash-command token (a Lexical decorator node) ───────────────────────────────────────
// Selecting a command from the "/" menu drops one of these inline: amber `/name` in the editor's
// font, carrying the command's description so a hover shows the same name + description card the
// shipped composer does. It serializes back to `/name` on submit, so a LEADING command token still
// routes through session.command exactly as the old plain-text `/name ` did — the port only
// restyles the token and adds the tooltip; the routing rule in submit() is unchanged.

type CommandPayload = {
  readonly name: string;
  readonly description: string | null;
};

type SerializedCommandNode = SerializedLexicalNode & CommandPayload;

// "unslop" → "Unslop": the tooltip header titleizes the raw command name (opencode commands carry
// only name + description, no separate display title), matching the reference card.
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

class ComposerCommandNode extends DecoratorNode<React.ReactElement> {
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

function $createCommandNode(payload: CommandPayload): ComposerCommandNode {
  return $applyNodeReplacement(new ComposerCommandNode(payload));
}

function isComposerCommandNode(node: LexicalNode | null | undefined): node is ComposerCommandNode {
  return node instanceof ComposerCommandNode;
}

// Walk the editor doc into the { text, files } the sidecar wants: text nodes contribute their
// text, line breaks a "\n", mention nodes their `@path` (and their file part). Root blocks join
// with "\n" so a multi-line prompt round-trips.
function serializeNode(node: LexicalNode, mentions: MentionPayload[]): string {
  if (isComposerMentionNode(node)) {
    const payload = node.getPayload();
    mentions.push(payload);
    return `@${payload.sideChatId === undefined ? payload.path : payload.label}`;
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

function serializePrompt(editor: LexicalEditor): {
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

// The composer accepts more than photos now: images and videos preview in a tile, audio shows a
// labeled tile, and everything else (pdf, etc.) stays a compact path chip.
type AttachmentKind = "image" | "video" | "audio" | "file";

function attachmentKind(attachment: Attachment): AttachmentKind {
  const mime = attachment.mime ?? "";
  if (mime.startsWith("image/") || attachment.path.startsWith("data:image/")) {
    return "image";
  }
  if (mime.startsWith("video/") || attachment.path.startsWith("data:video/")) {
    return "video";
  }
  if (mime.startsWith("audio/") || attachment.path.startsWith("data:audio/")) {
    return "audio";
  }
  return "file";
}

// The Lexical editor lives inside a LexicalComposer; PromptEditorInner reads the editor from
// context. The public props + imperative handle are identical to the old textarea version, so both
// the home Composer and the thread composer keep calling <PromptEditor> the same way.
function PromptEditor(props: {
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly directory?: string;
  readonly localCommands?: readonly SidecarCommand[];
  readonly sideChats?: readonly SideChatMention[];
  readonly menuPlacement?: "above" | "below";
  readonly onSubmit: (payload: PromptSubmit) => void;
  readonly onHasTextChange?: (hasText: boolean) => void;
  // Fires when the editor crosses the single-line ↔ multi-line boundary (text wraps or a line
  // break appears). The thread composer uses it to flip its compact pill into the expanded block.
  readonly onMultilineChange?: (multiline: boolean) => void;
  // Geometry hooks so a caller can reshape the shared editor without forking it: the outer block,
  // the contenteditable, and the placeholder overlay (kept aligned to the editor's text origin).
  readonly containerStyle?: stylex.StyleXStyles;
  readonly editorStyle?: stylex.StyleXStyles;
  readonly placeholderStyle?: stylex.StyleXStyles;
  readonly handleRef?: React.MutableRefObject<PromptEditorHandle | null>;
}): React.ReactElement {
  const initialConfig: InitialConfigType = {
    namespace: "honk-composer",
    editable: true,
    nodes: [ComposerMentionNode, ComposerCommandNode],
    onError: (error) => {
      throw error;
    },
  };
  return (
    <LexicalComposer initialConfig={initialConfig}>
      <PromptEditorInner {...props} />
    </LexicalComposer>
  );
}

function PromptEditorInner({
  placeholder,
  ariaLabel,
  directory,
  localCommands = [],
  sideChats = [],
  menuPlacement = "above",
  onSubmit,
  onHasTextChange,
  onMultilineChange,
  containerStyle,
  editorStyle,
  placeholderStyle,
  handleRef,
}: {
  readonly placeholder: string;
  readonly ariaLabel: string;
  // Scopes @-file search (and command list) to the thread's project instance.
  readonly directory?: string;
  // App-owned commands such as /side are merged with opencode's command catalog.
  readonly localCommands?: readonly SidecarCommand[];
  // Parent-thread side chats share the @ menu with files and serialize as transcript references.
  readonly sideChats?: readonly SideChatMention[];
  // "below" for composers near the top of the sheet (home); "above" for bottom-seated ones.
  readonly menuPlacement?: "above" | "below";
  readonly onSubmit: (payload: PromptSubmit) => void;
  readonly onHasTextChange?: (hasText: boolean) => void;
  // Fires on the single-line ↔ multi-line boundary — see PromptEditor's prop note.
  readonly onMultilineChange?: (multiline: boolean) => void;
  readonly containerStyle?: stylex.StyleXStyles;
  readonly editorStyle?: stylex.StyleXStyles;
  readonly placeholderStyle?: stylex.StyleXStyles;
  // Imperative handle for the caller's send button — a ref object, not an effect.
  readonly handleRef?: React.MutableRefObject<PromptEditorHandle | null>;
}): React.ReactElement {
  const [editor] = useLexicalComposerContext();
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const [menu, setMenu] = React.useState<MenuTrigger | null>(null);
  const [items, setItems] = React.useState<readonly MenuItem[]>([]);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [attachments, setAttachments] = React.useState<readonly Attachment[]>([]);
  // Placeholder visibility: shown while the editor text is empty (attachments don't fill the line).
  const [isEmpty, setIsEmpty] = React.useState(true);
  // The ref is the SYNCHRONOUS source of truth: paste resolutions land as separate microtasks
  // before React re-renders, so reading state (or a render-synced mirror) would drop all but
  // the last one. Every mutation writes the ref first, then mirrors into state for the render.
  const attachmentsRef = React.useRef<readonly Attachment[]>([]);
  // Latest-value refs so the once-registered Lexical command/update listeners (deps [editor]) read
  // current menu state and handlers without re-registering on every keystroke.
  const menuRef = React.useRef<MenuTrigger | null>(null);
  const itemsRef = React.useRef<readonly MenuItem[]>([]);
  const selectedIndexRef = React.useRef(0);
  const handleChangeRef = React.useRef<() => void>(() => {});
  const applyItemRef = React.useRef<(item: MenuItem) => void>(() => {});
  const submitRef = React.useRef<() => void>(() => {});
  // Last reported wrap state + a latest-ref so the [editor]-scoped ResizeObserver re-measures on
  // width changes (wrapping is width-dependent) without closing over a stale onMultilineChange.
  const multilineRef = React.useRef(false);
  const reportMultilineRef = React.useRef<() => void>(() => {});

  // Multi-line = the editor's rendered content exceeds ~1.5 line boxes (it has wrapped or a break
  // was inserted). Measured off the live DOM rect and reconciled to computed line-height/padding so
  // it self-adjusts to whatever geometry a caller applies via editorStyle; empty is always single.
  const reportMultiline = (): void => {
    const root = editor.getRootElement();
    let next = false;
    if (root !== null && (root.textContent ?? "").trim().length > 0) {
      const cs = window.getComputedStyle(root);
      const line = Number.parseFloat(cs.lineHeight);
      const padTop = Number.parseFloat(cs.paddingTop) || 0;
      const padBottom = Number.parseFloat(cs.paddingBottom) || 0;
      const lineUnit = Number.isFinite(line) && line > 0 ? line : 20;
      next = root.scrollHeight - padTop - padBottom > lineUnit * 1.5;
    }
    if (next !== multilineRef.current) {
      multilineRef.current = next;
      onMultilineChange?.(next);
    }
  };
  reportMultilineRef.current = reportMultiline;

  const notifyContent = (): void => {
    const text = editor
      .getEditorState()
      .read(() => $getRoot().getTextContent())
      .trim();
    // Attachment-only prompts are sendable (paste a photo, hit send) — content = text OR files.
    onHasTextChange?.(text.length > 0 || attachmentsRef.current.length > 0);
  };

  const setAttachmentList = (next: readonly Attachment[]): void => {
    attachmentsRef.current = next;
    setAttachments(next);
    notifyContent();
  };

  const addAttachments = (added: readonly Attachment[]): void => {
    const current = attachmentsRef.current;
    const next = [...current];
    for (const attachment of added) {
      if (!next.some((entry) => entry.key === attachment.key)) {
        next.push(attachment);
      }
    }
    if (next.length !== current.length) {
      setAttachmentList(next);
    }
  };

  // In-flight FileReader work — submit must not snapshot the attachment list while a pasted
  // file is still decoding, or the photo silently misses the prompt (paste ⏎ race).
  const pendingReadsRef = React.useRef<readonly Promise<void>[]>([]);

  // Pasted/dropped files: images (and anything else with bytes) ride as data: URLs with their
  // REAL mime — opencode decodes data: parts directly; a text/plain default would corrupt a photo.
  const attachFiles = (files: ArrayLike<File>): void => {
    for (const file of Array.from(files)) {
      const read = readAsDataUrl(file)
        .then((dataUrl) => {
          const label =
            file.name.length > 0
              ? file.name
              : `pasted.${(file.type.split("/")[1] ?? "bin").split("+")[0] ?? "bin"}`;
          // Browsers hand over screenshots with an empty File.type sometimes — sniff the
          // extension before falling back to the data url's own media type.
          const mime = file.type.length > 0 ? file.type : (mimeFromPath(label) ?? undefined);
          addAttachments([
            {
              key: `${label}:${String(file.size)}:${String(file.lastModified)}`,
              label,
              path: dataUrl,
              ...(mime !== undefined ? { mime } : {}),
            },
          ]);
        })
        .catch(() => {
          // An unreadable file simply never becomes a chip; the prompt still sends.
        })
        .finally(() => {
          pendingReadsRef.current = pendingReadsRef.current.filter((entry) => entry !== read);
        });
      pendingReadsRef.current = [...pendingReadsRef.current, read];
    }
  };
  // Commands are fetched once per editor and filtered locally; files re-query per keystroke.
  const commandsRef = React.useRef<readonly SidecarCommand[] | null>(null);
  const fetchSeq = React.useRef(0);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeMenu = (): void => {
    setMenu(null);
    setItems([]);
    setSelectedIndex(0);
  };

  const openFor = (trigger: MenuTrigger): void => {
    setMenu(trigger);
    const seq = ++fetchSeq.current;

    if (trigger.kind === "command") {
      const supply = (commands: readonly SidecarCommand[]): void => {
        if (fetchSeq.current !== seq) {
          return;
        }
        const query = trigger.query.toLowerCase();
        setItems(
          commands
            .filter((command) => command.name.toLowerCase().includes(query))
            .slice(0, MENU_MAX_ITEMS)
            .map((command) => ({
              key: command.name,
              title: `/${command.name}`,
              detail: command.description,
            })),
        );
        setSelectedIndex(0);
      };
      if (commandsRef.current !== null) {
        supply(commandsRef.current);
        return;
      }
      const commandClient = getBoundHonkClient();
      if (commandClient === null) {
        if (localCommands.length === 0) {
          closeMenu();
        } else {
          commandsRef.current = localCommands;
          supply(localCommands);
        }
        return;
      }
      void (async () => {
        try {
          const commands = await commandClient.listCommands(directory);
          const localNames = new Set(localCommands.map((command) => command.name));
          const merged = [
            ...localCommands,
            ...commands.filter((command) => !localNames.has(command.name)),
          ];
          commandsRef.current = merged;
          supply(merged);
        } catch {
          if (fetchSeq.current === seq) {
            closeMenu();
          }
        }
      })();
      return;
    }

    // File search — debounced; a stale response never lands (seq guard).
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      const query = trigger.query.toLowerCase();
      const sideChatItems: readonly MenuItem[] = sideChats
        .filter((sideChat) => sideChat.title.toLowerCase().includes(query))
        .map((sideChat) => ({
          key: `side-chat:${sideChat.id}`,
          title: sideChat.title,
          detail: "Side chat",
          mention: {
            path: sideChat.title,
            label: sideChat.title,
            sideChatId: sideChat.id,
          },
        }));
      const fileClient = getBoundHonkClient();
      if (fileClient === null) {
        if (fetchSeq.current === seq && sideChatItems.length > 0) {
          setItems(sideChatItems.slice(0, MENU_MAX_ITEMS));
          setSelectedIndex(0);
        } else {
          closeMenu();
        }
        return;
      }
      void (async () => {
        try {
          const paths = await fileClient.findFiles(trigger.query, directory);
          if (fetchSeq.current !== seq) {
            return;
          }
          setItems(
            [
              ...sideChatItems,
              ...paths.map((path) => ({
                key: path,
                title: basename(path),
                detail: path,
              })),
            ].slice(0, MENU_MAX_ITEMS),
          );
          setSelectedIndex(0);
        } catch {
          if (fetchSeq.current === seq) {
            closeMenu();
          }
        }
      })();
    }, FILE_SEARCH_DEBOUNCE_MS);
  };

  const syncTrigger = (): void => {
    const detected = editor.getEditorState().read((): MenuTrigger | null => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return null;
      }
      const node = selection.anchor.getNode();
      if (!$isTextNode(node)) {
        return null;
      }
      const before = node.getTextContent().slice(0, selection.anchor.offset);
      // The slash menu opens wherever a "/" starts a word (line start or after whitespace), matching
      // the old composer and the "@" rule below — not pinned to the prompt's first token. Whether a
      // picked command actually ROUTES as one is decided on submit (leading /token only).
      const slash = /(^|\s)\/([\w:.-]*)$/.exec(before);
      if (slash !== null) {
        return { kind: "command", query: slash[2] ?? "", start: 0, end: 0 };
      }
      const at = /(^|\s)@([^\s@]*)$/.exec(before);
      if (at !== null) {
        return { kind: "file", query: at[2] ?? "", start: 0, end: 0 };
      }
      return null;
    });
    if (detected === null) {
      if (menu !== null) {
        closeMenu();
      }
      return;
    }
    openFor(detected);
  };

  // Insert the picked row back into the doc: an @-file becomes a mention chip (replacing the typed
  // `@query`); a slash command rewrites the leading `/token` in place. Lexical node ops, not string
  // splicing — the chip is a real node, so submit can serialize it and attach its file part.
  const applyItem = (item: MenuItem): void => {
    const current = menuRef.current;
    if (current === null) {
      return;
    }
    if (current.kind === "file") {
      const mention = item.mention;
      const mime = mention === undefined ? mimeFromPath(item.key) : undefined;
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return;
        }
        const node = selection.anchor.getNode();
        if (!$isTextNode(node)) {
          return;
        }
        const before = node.getTextContent().slice(0, selection.anchor.offset);
        const at = /(^|\s)@([^\s@]*)$/.exec(before);
        if (at === null) {
          return;
        }
        const triggerStart = selection.anchor.offset - (at[2]?.length ?? 0) - 1;
        node.select(triggerStart, selection.anchor.offset);
        const range = $getSelection();
        if ($isRangeSelection(range)) {
          range.insertNodes([
            $createMentionNode(
              mention ?? {
                path: item.key,
                label: basename(item.key),
                ...(mime !== undefined ? { mime } : {}),
              },
            ),
            $createTextNode(" "),
          ]);
        }
      });
    } else {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return;
        }
        const node = selection.anchor.getNode();
        if (!$isTextNode(node)) {
          return;
        }
        const before = node.getTextContent().slice(0, selection.anchor.offset);
        const slash = /(^|\s)\/([\w:.-]*)$/.exec(before);
        if (slash === null) {
          return;
        }
        const triggerStart = selection.anchor.offset - (slash[2]?.length ?? 0) - 1;
        node.select(triggerStart, selection.anchor.offset);
        const range = $getSelection();
        if ($isRangeSelection(range)) {
          range.insertNodes([
            $createCommandNode({ name: item.key, description: item.detail }),
            $createTextNode(" "),
          ]);
        }
      });
    }
    editor.focus();
    notifyContent();
    closeMenu();
  };

  const submit = (): void => {
    // Paste-then-⏎: any still-decoding attachment finishes first, then this re-enters via the ref
    // (the finally() in attachFiles empties the pending list, so the retry cannot loop).
    const pending = pendingReadsRef.current;
    if (pending.length > 0) {
      void Promise.allSettled(pending).then(() => {
        submitRef.current();
      });
      return;
    }
    const serialized = serializePrompt(editor);
    const text = serialized.text.trim();
    // Two file sources: inline @-mentions (chips in the doc) and pasted/dropped/picked files.
    const files: SendMessageFile[] = [
      ...serialized.mentions
        .filter((mention) => mention.sideChatId === undefined)
        .map((mention) => ({
          path: mention.path,
          filename: mention.label,
          ...(mention.mime !== undefined ? { mime: mention.mime } : {}),
        })),
      ...attachmentsRef.current.map((attachment) => ({
        path: attachment.path,
        filename: attachment.label,
        ...(attachment.mime !== undefined ? { mime: attachment.mime } : {}),
      })),
    ];
    const sideChatIds = serialized.mentions
      .map((mention) => mention.sideChatId)
      .filter((sideChatId): sideChatId is string => sideChatId !== undefined);
    if (text.length === 0 && files.length === 0) {
      return;
    }
    // A leading /token that names a KNOWN command routes as one; anything else is prose. Never as
    // one WITH attachments: the command route (session.command) has no file slot, so classifying it
    // as a command would silently drop the files.
    let command: PromptSubmit["command"] = null;
    const slash = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
    if (slash !== null && files.length === 0 && sideChatIds.length === 0) {
      const name = slash[1] ?? "";
      const known = [...localCommands, ...(commandsRef.current ?? [])].some(
        (entry) => entry.name === name,
      );
      if (known) {
        command = { name, arguments: (slash[2] ?? "").trim() };
      }
    }
    onSubmit({ text, files, sideChatIds, command });
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      root.append($createParagraphNode());
    });
    setAttachmentList([]);
    closeMenu();
  };

  const handleChange = (): void => {
    const text = editor.getEditorState().read(() => $getRoot().getTextContent());
    setIsEmpty(text.length === 0);
    onHasTextChange?.(text.trim().length > 0 || attachmentsRef.current.length > 0);
    reportMultiline();
    syncTrigger();
  };

  // Mirror render-scope values/handlers into the latest-refs the [editor]-scoped listeners read.
  menuRef.current = menu;
  itemsRef.current = items;
  selectedIndexRef.current = selectedIndex;
  handleChangeRef.current = handleChange;
  applyItemRef.current = applyItem;
  submitRef.current = submit;

  if (handleRef !== undefined) {
    handleRef.current = {
      submit,
      focus: () => {
        editor.focus();
      },
      chooseImages: () => imageInputRef.current?.click(),
    };
  }

  // One [editor]-scoped registration: an update listener (drives the menu + send-enable) plus the
  // keyboard commands. Menu open → Enter/Tab apply the row, Arrow/Escape drive it; otherwise Enter
  // submits and Shift+Enter falls through to Lexical's own line break. Handlers read latest-refs so
  // the registration never needs to re-run past mount.
  const disposeRef = React.useRef<(() => void) | null>(null);
  // Effect-free registration (ADR 0025 / design-lint no-use-effect): a callback ref on the editor
  // shell wires the update listener + keyboard commands when it mounts and disposes on unmount.
  // The editor is stable (context), so [editor]-scoped useCallback runs the callback once each way.
  const registerEditor = React.useCallback(
    (node: HTMLDivElement | null): void => {
      if (node === null) {
        disposeRef.current?.();
        disposeRef.current = null;
        return;
      }
      // Re-measure the wrap state when the editor's width changes — wrapping is width-dependent, so
      // a narrower column can push a one-liner onto two lines with no keystroke to trigger it.
      const root = editor.getRootElement();
      const resize =
        root !== null && typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(() => {
              reportMultilineRef.current();
            })
          : null;
      resize?.observe(root as Element);
      const disposeListeners = mergeRegister(
        editor.registerUpdateListener(() => {
          handleChangeRef.current();
        }),
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (event) => {
            if (menuRef.current !== null && itemsRef.current.length > 0) {
              event?.preventDefault();
              const item = itemsRef.current[selectedIndexRef.current];
              if (item !== undefined) {
                applyItemRef.current(item);
              }
              return true;
            }
            if (event !== null && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              submitRef.current();
              return true;
            }
            return false;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_ARROW_DOWN_COMMAND,
          (event) => {
            if (menuRef.current === null || itemsRef.current.length === 0) {
              return false;
            }
            event?.preventDefault();
            setSelectedIndex((index) => (index + 1) % itemsRef.current.length);
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_ARROW_UP_COMMAND,
          (event) => {
            if (menuRef.current === null || itemsRef.current.length === 0) {
              return false;
            }
            event?.preventDefault();
            setSelectedIndex(
              (index) => (index - 1 + itemsRef.current.length) % itemsRef.current.length,
            );
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_ESCAPE_COMMAND,
          () => {
            if (menuRef.current === null) {
              return false;
            }
            setMenu(null);
            setItems([]);
            setSelectedIndex(0);
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_TAB_COMMAND,
          (event) => {
            if (menuRef.current === null || itemsRef.current.length === 0) {
              return false;
            }
            event?.preventDefault();
            const item = itemsRef.current[selectedIndexRef.current];
            if (item !== undefined) {
              applyItemRef.current(item);
            }
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
      );
      disposeRef.current = (): void => {
        disposeListeners();
        resize?.disconnect();
      };
    },
    [editor],
  );

  return (
    <div {...stylex.props(styles.editorBlock, containerStyle)}>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        aria-label="Attach files"
        {...stylex.props(styles.hiddenInput)}
        onChange={(event) => {
          attachFiles(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
        }}
      />
      {menu !== null && (
        <div
          role="listbox"
          aria-label={menu.kind === "file" ? "Files" : "Commands"}
          {...stylex.props(
            styles.menu,
            menuPlacement === "above" ? styles.menuAbove : styles.menuBelow,
          )}
        >
          {items.length === 0 ? (
            <div {...stylex.props(styles.menuEmpty)}>
              {menu.kind === "file" ? "No matching files" : "No matching commands"}
            </div>
          ) : (
            items.map((item, index) => (
              <button
                key={item.key}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                {...stylex.props(styles.menuRow, index === selectedIndex && styles.menuRowSelected)}
                // mousedown keeps focus in the editor (the browser-grade menu law).
                onMouseDown={(event) => {
                  event.preventDefault();
                  applyItem(item);
                }}
                onMouseEnter={() => {
                  setSelectedIndex(index);
                }}
              >
                <span {...stylex.props(styles.menuRowTitle)}>{item.title}</span>
                {item.detail !== null && item.detail !== item.title ? (
                  <span {...stylex.props(styles.menuRowDetail)}>{item.detail}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      )}

      {attachments.some((attachment) => attachmentKind(attachment) !== "file") ? (
        <div {...stylex.props(styles.attachmentGroup)}>
          {attachments
            .filter((attachment) => attachmentKind(attachment) !== "file")
            .map((attachment) => {
              const kind = attachmentKind(attachment);
              const previewUrl = attachmentPreviewUrl(attachment);
              return (
                <div key={attachment.key} {...stylex.props(styles.attachment)}>
                  {kind === "image" && previewUrl !== null ? (
                    <img
                      src={previewUrl}
                      alt={attachment.label}
                      {...stylex.props(styles.attachmentImage)}
                    />
                  ) : kind === "video" && previewUrl !== null ? (
                    // muted first-frame poster — a lightweight thumbnail, no controls in the tile.
                    <video src={previewUrl} muted {...stylex.props(styles.attachmentVideo)} />
                  ) : (
                    <span {...stylex.props(styles.attachmentFallback)}>{attachment.label}</span>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.label}`}
                    {...stylex.props(styles.attachmentAction)}
                    onClick={() => {
                      setAttachmentList(
                        attachmentsRef.current.filter((entry) => entry.key !== attachment.key),
                      );
                    }}
                  >
                    <Icon icon={IconCrossSmall} size="sm" />
                  </button>
                </div>
              );
            })}
        </div>
      ) : null}

      {attachments.some((attachment) => attachmentKind(attachment) === "file") && (
        <div {...stylex.props(styles.chips)}>
          {attachments
            .filter((attachment) => attachmentKind(attachment) === "file")
            .map((attachment) => (
              <span key={attachment.key} {...stylex.props(styles.chip)} title={attachment.label}>
                <span {...stylex.props(styles.chipLabel)}>{attachment.label}</span>
                <button
                  type="button"
                  aria-label={`Remove ${attachment.label}`}
                  {...stylex.props(styles.chipRemove)}
                  onClick={() => {
                    setAttachmentList(
                      attachmentsRef.current.filter((entry) => entry.key !== attachment.key),
                    );
                  }}
                >
                  <Icon icon={IconCrossSmall} size="sm" />
                </button>
              </span>
            ))}
        </div>
      )}

      <div
        ref={registerEditor}
        {...stylex.props(styles.editorShell)}
        // The upload doors: ⌘V a copied file, or drop one anywhere on the editor.
        onPaste={(event) => {
          if (event.clipboardData.files.length > 0) {
            event.preventDefault();
            attachFiles(event.clipboardData.files);
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
          }
        }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length > 0) {
            event.preventDefault();
            attachFiles(event.dataTransfer.files);
          }
        }}
      >
        {isEmpty ? (
          <div {...stylex.props(styles.editorPlaceholder, placeholderStyle)}>{placeholder}</div>
        ) : null}
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              aria-label={ariaLabel}
              spellCheck
              className={stylex.props(styles.editor, editorStyle).className}
            />
          }
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
    </div>
  );
}

function attachmentPreviewUrl(attachment: Attachment): string | null {
  if (
    attachment.path.startsWith("data:") ||
    attachment.path.startsWith("blob:") ||
    attachment.path.startsWith("file:")
  ) {
    return attachment.path;
  }
  return null;
}

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const [last = trimmed] = trimmed.split(/[\\/]/).slice(-1);
  return last.length > 0 ? last : path;
}

// Mode is a single rotating pill: one prompt surface, four ways to run it. Click or Shift+Tab
// (handled by the enclosing composer) advances to the next mode; the selected mode changes the
// opencode agent while the adjacent model dropdown controls the pinned model bundle.
//
// The pill IS the ghost footer Button (Base UI primitive), so it matches the rest of the control
// row; its per-mode tint is PURE CSS keyed off `data-mode` (see index.css), the Astryx model —
// override the primitive with plain CSS / custom properties, not app-level StyleX. build (default)
// has no rule and stays the plain ghost; the constrained modes light up (plan = blue, debug =
// violet, ask = muted). The label always shows. Click or Shift+Tab cycles the mode.
function ModeControl({
  value,
  onValueChange,
}: {
  readonly value: ModeId;
  readonly onValueChange: (id: string) => void;
}): React.ReactElement {
  const mode = modeById(value);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-mode={value}
      title={`${mode.label} mode — ${mode.description} Shift+Tab or click to switch.`}
      aria-label={`Mode: ${mode.label}. Shift+Tab or click to switch.`}
      xstyle={styles.footerPill}
      onClick={() => {
        onValueChange(nextModeId(value));
      }}
    >
      {mode.label}
    </Button>
  );
}

function presetDisplayLabel(preset: PresetDefinition): string {
  return `${preset.label.slice(0, 1).toUpperCase()}${preset.label.slice(1)}`;
}

function PresetProviderIcon({ preset }: { readonly preset: PresetDefinition }): React.ReactElement {
  return (
    <Icon
      icon={preset.agentModel.providerID === "anthropic" ? IconClawd : IconOpenaiCodex}
      size="sm"
      tone="muted"
    />
  );
}

function PresetSelector({
  value,
  onValueChange,
}: {
  readonly value: string;
  readonly onValueChange: (id: string) => void;
}): React.ReactElement {
  const selected = presetById(value);

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Model preset: ${presetDisplayLabel(selected)}`}
            iconStart={<PresetProviderIcon preset={selected} />}
            iconEnd={<Icon icon={IconChevronDownMedium} size="sm" tone="faint" />}
            xstyle={styles.footerPill}
          >
            {presetDisplayLabel(selected)}
          </Button>
        }
      />
      <Menu.Popup side="bottom" align="start" xstyle={styles.modelMenu}>
        <Menu.Group>
          <Menu.GroupLabel>Model preset</Menu.GroupLabel>
          {PRESETS.map((preset) => (
            <Menu.Item
              key={preset.id}
              xstyle={styles.presetRow}
              onClick={() => {
                onValueChange(preset.id);
              }}
            >
              <span {...stylex.props(styles.presetRowTop)}>
                <PresetProviderIcon preset={preset} />
                <span {...stylex.props(styles.presetLabel)}>{presetDisplayLabel(preset)}</span>
                <span {...stylex.props(styles.presetVariant)}>{preset.agentVariant}</span>
                {preset.id === selected.id ? (
                  <Icon icon={IconCheckmark1} size="sm" tone="muted" />
                ) : null}
              </span>
              <span {...stylex.props(styles.presetSub)}>
                {preset.agentLabel} · {preset.oracleLabel}
              </span>
            </Menu.Item>
          ))}
        </Menu.Group>
      </Menu.Popup>
    </Menu.Root>
  );
}

function ComposerAttachmentButton({
  editorRef,
}: {
  readonly editorRef: React.RefObject<PromptEditorHandle | null>;
}): React.ReactElement {
  return (
    <Tooltip label="Add attachments">
      <IconButton
        type="button"
        aria-label="Add attachments"
        size="sm"
        variant="ghost"
        xstyle={styles.attachmentButton}
        onClick={() => {
          editorRef.current?.chooseImages();
        }}
      >
        <Icon icon={IconPlusSmall} size="sm" />
      </IconButton>
    </Tooltip>
  );
}

function Composer({
  directory,
  directoryLabel,
  onDirectoryPicked,
}: {
  // Where the new thread will live. Undefined → the default working folder.
  readonly directory?: string;
  // What the location chip prints (home passes the selected project's name).
  readonly directoryLabel?: string;
  // The picker handoff — home owns the selection state, the chip just asks.
  readonly onDirectoryPicked?: (path: string) => void;
}): React.ReactElement {
  const presetId = useSelectedPreset();
  const preset = presetById(presetId);
  const mode = useHomeMode();
  const editorRef = React.useRef<PromptEditorHandle | null>(null);
  // Send-button enablement only — keystrokes stay out of any store.
  const [hasText, setHasText] = React.useState(false);

  const handleSubmit = (payload: PromptSubmit): void => {
    // Mode picks the agent (soft, switchable later); the preset's model bundle hard-pins. `mode`
    // rides alongside so the new thread pins it as its own override (tab-store) — the home pill no
    // longer leaks into unrelated threads.
    tabActions.openNew({
      prompt: payload.text,
      agent: modeAgentName(mode),
      mode,
      model: preset.agentModel,
      variant: preset.agentVariant,
      ...(directory !== undefined ? { directory } : {}),
      ...(payload.files.length > 0 ? { files: payload.files } : {}),
      ...(payload.command !== null ? { command: payload.command } : {}),
    });
    // Sticky working directory: starting a thread here makes this folder the app-wide default that
    // newly opened tabs (⌘N, command menu, the tab "+") inherit — see tab-store.createAndOpenThread.
    if (directory !== undefined) {
      appSettingsActions.setDefaultProjectDirectory(directory);
    }
    // A constrained mode is a deliberate ONE-SHOT: the mode we just pinned onto the new thread, not a
    // persisted global. Reset the home pill to the default so the NEXT thread starts in build unless
    // the user re-picks — the fix for "plan mode auto treats everything as plan". The launch has
    // already navigated to the new thread, so this reset happens off the visible home composer.
    if (mode !== DEFAULT_MODE) {
      modeActions.setHomeMode(DEFAULT_MODE);
    }
  };

  const pickTarget = (): void => {
    void pickFolder(directory ?? null).then((path) => {
      if (path !== null) {
        onDirectoryPicked?.(path);
      }
    });
  };

  return (
    <div {...stylex.props(styles.root)}>
      <div
        {...stylex.props(styles.card)}
        onKeyDown={(event) => {
          if (event.key === "Tab" && event.shiftKey && !event.defaultPrevented) {
            event.preventDefault();
            modeActions.setHomeMode(nextModeId(mode));
          }
        }}
      >
        <PromptEditor
          placeholder="Describe a task…"
          ariaLabel="New thread prompt"
          menuPlacement="below"
          {...(directory !== undefined ? { directory } : {})}
          onSubmit={handleSubmit}
          onHasTextChange={setHasText}
          handleRef={editorRef}
        />
        <div {...stylex.props(styles.footer)}>
          <ComposerAttachmentButton editorRef={editorRef} />
          <ModeControl
            value={mode}
            onValueChange={(id) => {
              modeActions.setHomeMode(id);
            }}
          />
          <PresetSelector
            value={presetId}
            onValueChange={(id) => {
              presetActions.select(id);
            }}
          />
          {onDirectoryPicked !== undefined && (
            <Tooltip
              label={
                directory !== undefined
                  ? `${directory} — click to change`
                  : "New threads start in your default folder — click to pick another"
              }
            >
              <button type="button" {...stylex.props(styles.locationChip)} onClick={pickTarget}>
                <Icon icon={IconFolder1} size="sm" />
                <span {...stylex.props(styles.locationLabel)}>
                  {directoryLabel ?? (directory !== undefined ? basename(directory) : "Default")}
                </span>
              </button>
            </Tooltip>
          )}
          <div {...stylex.props(styles.footerSpacer)} />
          <IconButton
            aria-label="Send"
            variant="primary"
            size="sm"
            xstyle={styles.footerPill}
            disabled={!hasText}
            onClick={() => {
              editorRef.current?.submit();
            }}
          >
            <Icon icon={IconArrowUp} size="sm" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

export { Composer, ComposerAttachmentButton, ModeControl, PromptEditor };
export type { PromptEditorHandle, PromptSubmit };
