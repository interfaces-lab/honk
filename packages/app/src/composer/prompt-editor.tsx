// Lexical editor shared by new threads and replies. Only a leading /token runs as a command.
// "@" opens the file menu.

import * as stylex from "@stylexjs/stylex";
import { openCodeSessionRef, type OpenCodeClient, type OpenCodeServerKey } from "@honk/opencode";
import { basename } from "@honk/shared/paths";
import { colorVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type NodeKey,
} from "lexical";
import * as React from "react";

import { readDesktopBrowserAvailability } from "../desktop-bridge";
import { errorMessage } from "../error-message";
import { DEFAULT_MODE, type ModeDefinition } from "../modes";
import { actions as toastActions } from "../toast-store";
import {
  classifyPromptCommand,
  expandPromptCommandTemplate,
  formatInlineContextDataUrl,
  formatSkillReference,
  hasSubmittablePrompt,
  waitForPendingReads,
} from "./submission";
import type { PromptEditorDraft, PromptEditorHandle, PromptSubmit } from "./types";
import { AttachmentList, attachmentFromFile, mimeFromPath, type Attachment } from "./attachments";
import { findFileSuggestions } from "./file-suggestions";
import {
  $createCommandNode,
  $createContextNode,
  $createMentionNode,
  ComposerCommandNode,
  ComposerContextNode,
  ComposerMentionNode,
  isComposerContextNode,
  registerChipDeletion,
  serializePrompt,
  type ContextPayload,
  type MentionPayload,
  type SerializedMention,
} from "./prompt-editor-nodes";
import { type ComposerCommand, type PromptComposerFile } from "../open-code-view";
import { physicalAttachmentsFromPromptFiles } from "./prompt-files";
import { PromptMenu, type PromptMenuAnchor, type PromptMenuItem } from "./prompt-menu";
import { useSessionInventoryWatchSelector } from "../use-sdk-watch";

const EDITOR_MIN_HEIGHT = "52px";
// Screen-level backstop only. Hosts bound the editor through the flex chain (minHeight: 0 down to
// the scrollable ContentEditable), so the editor grows to the space its host allows and never past
// the viewport.
const EDITOR_MAX_HEIGHT = "calc(100dvh - 120px)";
const EDITOR_PAD_X = "16px";
const EDITOR_PAD_TOP = "16px";
const FILE_SEARCH_DEBOUNCE_MS = 120;
const MENU_MAX_ITEMS = 32;

const styles = stylex.create({
  editorBlock: { position: "relative", display: "flex", flexDirection: "column", minHeight: 0 },
  hiddenInput: { display: "none" },
  editor: {
    width: "100%",
    boxSizing: "border-box",
    minHeight: EDITOR_MIN_HEIGHT,
    maxHeight: EDITOR_MAX_HEIGHT,
    // oxlint-disable-next-line honk/design-no-raw-values -- 16px composer editor inline padding; no 16px spacing token owns this surface
    paddingInline: EDITOR_PAD_X,
    // oxlint-disable-next-line honk/design-no-raw-values -- 16px composer editor top padding; no 16px spacing token owns this surface
    paddingTop: EDITOR_PAD_TOP,
    paddingBottom: spaceVars["--honk-space-gutter"],
    margin: 0,
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body-lg"],
    lineHeight: fontVars["--honk-leading-body-lg"],
    overflowY: "auto",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    cursor: "text",
  },
  // Flex column so a height-constrained host shrinks the ContentEditable itself, which then
  // scrolls internally instead of pushing the composer past its container.
  editorShell: { position: "relative", minHeight: 0, display: "flex", flexDirection: "column" },
  editorPlaceholder: {
    position: "absolute",
    insetInlineStart: EDITOR_PAD_X,
    insetBlockStart: EDITOR_PAD_TOP,
    pointerEvents: "none",
    userSelect: "none",
    color: colorVars["--honk-color-text-faint"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body-lg"],
    lineHeight: fontVars["--honk-leading-body-lg"],
  },
});

type MenuTrigger = {
  readonly kind: "chat" | "command" | "file" | "source";
  readonly query: string;
};

// Mirror the trigger token with a live DOM range. Ranges track their boundary points through
// reflow, so the menu keeps measuring the right box while the caret moves and the composer grows.
function triggerRange(leadOffset: number): Range | null {
  const selection = window.getSelection();
  if (selection === null || !selection.isCollapsed) return null;
  const node = selection.anchorNode;
  if (node === null || node.nodeType !== Node.TEXT_NODE) return null;
  const length = node.textContent?.length ?? 0;
  if (leadOffset < 0 || leadOffset > length || selection.anchorOffset > length) return null;
  const range = document.createRange();
  range.setStart(node, leadOffset);
  range.setEnd(node, selection.anchorOffset);
  return range;
}

// getBoundingClientRect unions every fragment of a wrapped range, so a long @path broken across two
// lines reports a full-width box starting at the line start and the menu leaves the trigger behind.
// The first fragment is the one holding "/" or "@", which is what the menu must line up with.
function triggerRect(range: Range): DOMRect {
  return range.getClientRects()[0] ?? range.getBoundingClientRect();
}

type MenuItem = PromptMenuItem & {
  readonly mention?: MentionPayload;
  readonly command?: ComposerCommand;
  readonly sessionID?: string;
  readonly server?: OpenCodeServerKey;
};

type DraftInlineToken =
  | {
      readonly kind: "mention";
      readonly start: number;
      readonly end: number;
      readonly payload: MentionPayload;
    }
  | {
      readonly kind: "context";
      readonly start: number;
      readonly end: number;
      readonly payload: ContextPayload;
    };

function replaceEditorDraft(draft: PromptEditorDraft): void {
  const root = $getRoot();
  root.clear();
  const tokens = draftInlineTokens(draft);
  const paragraphs = [$createParagraphNode()];
  [
    ...tokens.flatMap((token, index) => [
      draft.text.slice(index === 0 ? 0 : (tokens[index - 1]?.end ?? 0), token.start),
      token,
    ]),
    draft.text.slice(tokens.at(-1)?.end ?? 0),
  ].forEach((fragment) => {
    if (typeof fragment === "string") {
      fragment.split("\n").forEach((text, index) => {
        if (index > 0) paragraphs.push($createParagraphNode());
        if (text.length > 0) paragraphs.at(-1)?.append($createTextNode(text));
      });
      return;
    }
    paragraphs
      .at(-1)
      ?.append(
        fragment.kind === "mention"
          ? $createMentionNode(fragment.payload)
          : $createContextNode(fragment.payload),
      );
  });
  paragraphs.forEach((paragraph) => root.append(paragraph));
}

function draftInlineTokens(draft: PromptEditorDraft): readonly DraftInlineToken[] {
  const mentions: readonly DraftInlineToken[] = draft.files.flatMap((file) => {
    if (
      file.source === undefined ||
      file.source.end > draft.text.length ||
      draft.text.slice(file.source.start, file.source.end) !== file.source.text
    ) {
      return [];
    }
    return [
      {
        kind: "mention" as const,
        start: file.source.start,
        end: file.source.end,
        payload: {
          kind: "file" as const,
          path: file.path,
          label: file.filename ?? basename(file.path),
          ...(file.mime === undefined ? {} : { mime: file.mime }),
        },
      },
    ];
  });
  const contexts = draft.files.reduce<{
    from: number;
    readonly tokens: DraftInlineToken[];
  }>(
    (current, file) => {
      if (file.context === undefined) return current;
      const label =
        file.filename ?? (file.context.kind === "chat" ? "Past chat" : "Current branch diff");
      const text = `@${label}`;
      const found = draft.text.indexOf(text, current.from);
      const start = found === -1 ? draft.text.length : found;
      current.from = found === -1 ? current.from : start + text.length;
      current.tokens.push({
        kind: "context",
        start,
        end: found === -1 ? start : start + text.length,
        payload: {
          kind: file.context.kind,
          sourceKey: file.context.sourceKey,
          label,
          path: file.path.length === 0 ? null : file.path,
          mime: file.mime ?? "text/plain",
        },
      });
      return current;
    },
    { from: 0, tokens: [] },
  ).tokens;
  // Mentions win a shared start offset; the dedupe below then drops the context that lost. Tokens
  // of the same kind must compare equal or the sort is inconsistent and the order is unspecified.
  return [...mentions, ...contexts]
    .sort(
      (left, right) =>
        left.start - right.start ||
        Number(left.kind === "context") - Number(right.kind === "context"),
    )
    .reduce<DraftInlineToken[]>((tokens, token) => {
      const previous = tokens.at(-1);
      if (previous !== undefined && token.start < previous.end) return tokens;
      tokens.push(token);
      return tokens;
    }, []);
}

function promptFileFromMention(mention: SerializedMention, sourceOffset = 0): PromptComposerFile {
  return {
    path: mention.path,
    filename: mention.label,
    ...(mention.mime === undefined ? {} : { mime: mention.mime }),
    source: {
      text: mention.source.text,
      start: mention.source.start - sourceOffset,
      end: mention.source.end - sourceOffset,
    },
  };
}

export function PromptEditor(props: {
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly autoFocus?: boolean;
  readonly directory?: string;
  readonly client?: OpenCodeClient | null;
  readonly modes?: readonly ModeDefinition[];
  readonly currentMode?: ModeDefinition["id"];
  readonly onModeSelect?: (id: ModeDefinition["id"]) => void;
  readonly localCommands?: readonly ComposerCommand[];
  readonly onCommandSelect?: (name: string) => boolean;
  readonly menuPlacement?: "above" | "below";
  readonly onSubmit: (payload: PromptSubmit) => boolean | void | Promise<boolean | void>;
  // Enter on an empty composer. The thread composer sends the earliest queued message.
  readonly onEmptySubmit?: () => void;
  // Arrow Up on an empty composer enters an owning queue without coupling Lexical to its DOM.
  readonly onEmptyArrowUp?: () => boolean;
  readonly onEscape?: () => void;
  readonly onHasTextChange?: (hasText: boolean) => void;
  readonly onDraftChange?: (draft: PromptEditorDraft) => void;
  readonly onNeedsExpansionChange?: (needsExpansion: boolean) => void;
  // Measure with the compact width. Measuring after expansion makes the editor flip between layouts.
  readonly multilineMeasureWidth?: () => number | null;
  readonly multilineMeasureStyle?: stylex.StyleXStyles;
  readonly containerStyle?: stylex.StyleXStyles;
  readonly editorStyle?: stylex.StyleXStyles;
  readonly placeholderStyle?: stylex.StyleXStyles;
  readonly attachmentsStyle?: stylex.StyleXStyles;
  readonly initialDraft?: PromptEditorDraft;
  readonly handleRef?: React.MutableRefObject<PromptEditorHandle | null>;
}): React.ReactElement {
  const initialDraft = props.initialDraft;
  const initialConfig: InitialConfigType = {
    namespace: "honk-composer",
    editable: true,
    nodes: [ComposerMentionNode, ComposerCommandNode, ComposerContextNode],
    ...(initialDraft === undefined
      ? {}
      : {
          editorState:
            initialDraft.editorState ??
            (() => {
              replaceEditorDraft(initialDraft);
            }),
        }),
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
  autoFocus = false,
  directory: _directory,
  client,
  modes = [],
  currentMode,
  onModeSelect,
  localCommands = [],
  onCommandSelect,
  menuPlacement = "above",
  onSubmit,
  onEmptySubmit,
  onEmptyArrowUp,
  onEscape,
  onHasTextChange,
  onDraftChange,
  onNeedsExpansionChange,
  multilineMeasureWidth,
  multilineMeasureStyle,
  containerStyle,
  editorStyle,
  placeholderStyle,
  attachmentsStyle,
  initialDraft,
  handleRef,
}: {
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly autoFocus?: boolean;
  readonly directory?: string;
  readonly client?: OpenCodeClient | null;
  readonly modes?: readonly ModeDefinition[];
  readonly currentMode?: ModeDefinition["id"];
  readonly onModeSelect?: (id: ModeDefinition["id"]) => void;
  // These commands appear before OpenCode commands. Returning true handles the choice locally.
  readonly localCommands?: readonly ComposerCommand[];
  readonly onCommandSelect?: (name: string) => boolean;
  readonly menuPlacement?: "above" | "below";
  readonly onSubmit: (payload: PromptSubmit) => boolean | void | Promise<boolean | void>;
  readonly onEmptySubmit?: () => void;
  readonly onEmptyArrowUp?: () => boolean;
  readonly onEscape?: () => void;
  readonly onHasTextChange?: (hasText: boolean) => void;
  readonly onDraftChange?: (draft: PromptEditorDraft) => void;
  readonly onNeedsExpansionChange?: (needsExpansion: boolean) => void;
  readonly multilineMeasureWidth?: () => number | null;
  readonly multilineMeasureStyle?: stylex.StyleXStyles;
  readonly containerStyle?: stylex.StyleXStyles;
  readonly editorStyle?: stylex.StyleXStyles;
  readonly placeholderStyle?: stylex.StyleXStyles;
  readonly attachmentsStyle?: stylex.StyleXStyles;
  readonly initialDraft?: PromptEditorDraft;
  readonly handleRef?: React.MutableRefObject<PromptEditorHandle | null>;
}): React.ReactElement {
  const [editor] = useLexicalComposerContext();
  const menuId = React.useId();
  const onEscapeRef = React.useRef(onEscape);
  const onEmptyArrowUpRef = React.useRef(onEmptyArrowUp);
  // Lexical owns the key listener lifetime, so synchronize its callback refs after React commits.
  React.useLayoutEffect(() => {
    onEscapeRef.current = onEscape;
    onEmptyArrowUpRef.current = onEmptyArrowUp;
  }, [onEmptyArrowUp, onEscape]);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const [menu, setMenu] = React.useState<MenuTrigger | null>(null);
  const [menuAnchor, setMenuAnchor] = React.useState<PromptMenuAnchor | null>(null);
  const [items, setItems] = React.useState<readonly MenuItem[]>([]);
  const [menuStatus, setMenuStatus] = React.useState<"error" | "idle" | "loading">("idle");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [isKeyboardNavigation, setIsKeyboardNavigation] = React.useState(false);
  const [attachments, setAttachments] = React.useState<readonly Attachment[]>(() =>
    physicalAttachmentsFromPromptFiles(
      initialDraft?.files ?? [],
      "draft",
      initialDraft?.editorState,
    ),
  );
  const [isEmpty, setIsEmpty] = React.useState(
    (initialDraft?.text.length ?? 0) === 0 &&
      initialDraft?.files.some((file) => file.context !== undefined) !== true,
  );
  const isSubmittableRef = React.useRef(
    (initialDraft?.text.trim().length ?? 0) > 0 || (initialDraft?.files.length ?? 0) > 0,
  );
  const [repositoryState, setRepositoryState] = React.useState<{
    readonly key: string;
    readonly value: boolean;
  } | null>(null);
  const sessions = useSessionInventoryWatchSelector(
    (snapshot) => snapshot.state?.rootSessions ?? [],
  );
  // Pasted files finish in separate microtasks. Update this ref before React renders again.
  const attachmentsRef = React.useRef<readonly Attachment[]>(attachments);
  // Lexical registers these listeners once. Refs give them the latest props without re-registering.
  const menuRef = React.useRef<MenuTrigger | null>(null);
  const menuAnchorRef = React.useRef<PromptMenuAnchor | null>(null);
  const itemsRef = React.useRef<readonly MenuItem[]>([]);
  const selectedIndexRef = React.useRef(0);
  const handleChangeRef = React.useRef<() => void>(() => {});
  const applyItemRef = React.useRef<(item: MenuItem) => void>(() => {});
  const submitRef = React.useRef<
    (options?: { readonly retryAfterRead?: boolean; readonly sendNow?: boolean }) => void
  >(() => {});
  // Callers provide compact-layout measurements so wrapping does not change the width being measured.
  const needsExpansionRef = React.useRef(false);
  const reportNeedsExpansionRef = React.useRef<() => void>(() => {});
  const multilineMeasureClassName =
    stylex.props(styles.editor, multilineMeasureStyle ?? editorStyle).className ?? "";

  const repositoryKey = `${client?.server.key ?? "none"}:${_directory ?? "none"}`;
  const isRepository = repositoryState?.key === repositoryKey && repositoryState.value;

  React.useEffect(() => {
    if (client === null || client === undefined || _directory === undefined) return;
    let active = true;
    void client.vcs
      .info({ directory: _directory })
      .then((info) => {
        if (active) {
          setRepositoryState({
            key: repositoryKey,
            value: info.branch !== undefined || info.default_branch !== undefined,
          });
        }
      })
      .catch(() => {
        if (active) setRepositoryState({ key: repositoryKey, value: false });
      });
    return () => {
      active = false;
    };
  }, [client, _directory, repositoryKey]);

  // Attachments always need their own band row; text needs it once it wraps. Text is measured on a
  // detached clone because changing the live editor would trigger ResizeObserver and make the
  // layout alternate between compact and expanded.
  const reportNeedsExpansion = (): void => {
    const root = editor.getRootElement();
    let next = attachmentsRef.current.length > 0;
    if (!next && root !== null && (root.textContent ?? "").trim().length > 0) {
      const requestedWidth = multilineMeasureWidth?.() ?? null;
      const measure =
        requestedWidth !== null && requestedWidth > 0
          ? (root.cloneNode(true) as HTMLElement)
          : root;
      if (measure !== root) {
        measure.className = multilineMeasureClassName;
        measure.removeAttribute("contenteditable");
        measure.removeAttribute("role");
        measure.setAttribute("aria-hidden", "true");
        measure.style.position = "fixed";
        measure.style.insetInlineStart = "-100000px";
        measure.style.insetBlockStart = "0";
        measure.style.width = `${requestedWidth}px`;
        measure.style.height = "auto";
        measure.style.maxHeight = "none";
        measure.style.overflow = "visible";
        measure.style.visibility = "hidden";
        measure.style.pointerEvents = "none";
        root.parentElement?.append(measure);
      }
      const cs = window.getComputedStyle(measure);
      const line = Number.parseFloat(cs.lineHeight);
      const padTop = Number.parseFloat(cs.paddingTop) || 0;
      const padBottom = Number.parseFloat(cs.paddingBottom) || 0;
      const lineUnit = Number.isFinite(line) && line > 0 ? line : 20;
      next = measure.scrollHeight - padTop - padBottom > lineUnit * 1.5;
      if (measure !== root) {
        measure.remove();
      }
    }
    if (next !== needsExpansionRef.current) {
      needsExpansionRef.current = next;
      onNeedsExpansionChange?.(next);
    }
  };
  reportNeedsExpansionRef.current = reportNeedsExpansion;

  const currentDraft = (): PromptEditorDraft => {
    const serialized = serializePrompt(editor);
    return {
      text: serialized.text,
      editorState: JSON.stringify(editor.getEditorState()),
      files: [
        ...serialized.mentions.map((mention) => promptFileFromMention(mention)),
        ...serialized.contexts.map((context) => ({
          path: context.path ?? "",
          filename: context.label,
          mime: context.mime,
          context: { kind: context.kind, sourceKey: context.sourceKey },
        })),
        ...attachmentsRef.current.map((attachment) => ({
          path: attachment.path,
          filename: attachment.label,
          ...(attachment.mime !== undefined ? { mime: attachment.mime } : {}),
        })),
      ],
    };
  };

  const notifyContent = (): void => {
    const draft = currentDraft();
    // Attachment-only prompts are sendable.
    onHasTextChange?.(draft.text.trim().length > 0 || draft.files.length > 0);
    onDraftChange?.(draft);
  };

  const setAttachmentList = (next: readonly Attachment[]): void => {
    attachmentsRef.current = next;
    setAttachments(next);
    notifyContent();
    reportNeedsExpansion();
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

  // Wait for pasted files before reading attachments. This handles Enter pressed during a paste.
  const pendingReadsRef = React.useRef<readonly Promise<void>[]>([]);

  const updateContextPath = (nodeKey: NodeKey, path: string): void => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (isComposerContextNode(node)) node.setPath(path);
    });
  };

  const removeContext = (nodeKey: NodeKey): void => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (isComposerContextNode(node)) node.remove();
    });
  };

  const trackPendingRead = (read: Promise<void>): void => {
    pendingReadsRef.current = [...pendingReadsRef.current, read];
  };

  // Keep the file's MIME type in data URLs. Using text/plain would corrupt images.
  const attachFiles = (files: ArrayLike<File>): void => {
    for (const file of Array.from(files)) {
      const read = attachmentFromFile(file)
        .then((attachment) => {
          addAttachments([attachment]);
        })
        .catch(() => {
          // Skip unreadable files and send the rest of the prompt.
        })
        .finally(() => {
          pendingReadsRef.current = pendingReadsRef.current.filter((entry) => entry !== read);
        });
      pendingReadsRef.current = [...pendingReadsRef.current, read];
    }
  };
  // Load commands once and filter them locally. Search files after each input change.
  const commandsRef = React.useRef<readonly ComposerCommand[] | null>(null);
  const skillNamesRef = React.useRef<ReadonlySet<string>>(new Set());
  const fetchSeq = React.useRef(0);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileSearchRef = React.useRef<AbortController | null>(null);

  const closeMenu = (): void => {
    fetchSeq.current += 1;
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    fileSearchRef.current?.abort();
    fileSearchRef.current = null;
    menuRef.current = null;
    menuAnchorRef.current = null;
    itemsRef.current = [];
    selectedIndexRef.current = 0;
    setMenuAnchor(null);
    setMenu(null);
    setItems([]);
    setSelectedIndex(0);
    setIsKeyboardNavigation(false);
    setMenuStatus("idle");
  };

  const openFor = (trigger: MenuTrigger): void => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    fileSearchRef.current?.abort();
    fileSearchRef.current = null;
    // Sync the ref before React renders. Lexical commits fire syncTrigger in a microtask, and a
    // stale menu kind there would undo menu navigation (e.g. Back re-opening the file menu).
    const previous = menuRef.current;
    menuRef.current = trigger;
    setMenu(trigger);
    setIsKeyboardNavigation(false);
    if (previous?.kind !== trigger.kind || previous.query !== trigger.query) {
      itemsRef.current = [];
      selectedIndexRef.current = 0;
      setItems([]);
      setSelectedIndex(0);
    }
    const seq = ++fetchSeq.current;

    if (trigger.kind === "command") {
      const supply = (commands: readonly ComposerCommand[]): void => {
        if (fetchSeq.current !== seq) {
          return;
        }
        const query = trigger.query.toLowerCase();
        const groupedCommands = commands.reduce(
          (groups, command) => {
            if (!command.name.toLowerCase().includes(query)) return groups;
            groups[skillNamesRef.current.has(command.name) ? "skills" : "commands"].push(command);
            return groups;
          },
          { skills: [] as ComposerCommand[], commands: [] as ComposerCommand[] },
        );
        const visiblePerSection = query.length === 0 ? 3 : MENU_MAX_ITEMS;
        const commandItems: MenuItem[] = [
          ...groupedCommands.skills.slice(0, visiblePerSection),
          ...groupedCommands.commands.slice(0, visiblePerSection),
        ].map((command) => ({
          key: `command:${command.name}`,
          title: command.name,
          detail: command.description,
          kind: skillNamesRef.current.has(command.name) ? "skill" : "command",
          section: skillNamesRef.current.has(command.name) ? "Skills" : "Commands",
          command,
        }));
        const modeItems: MenuItem[] = modes.flatMap((mode) => {
          // Build is the resting state, not a pick: you leave a mode by reselecting it.
          if (mode.id === "build") return [];
          if (
            !mode.label.toLowerCase().includes(query) &&
            !mode.description.toLowerCase().includes(query)
          ) {
            return [];
          }
          return [
            {
              key: `mode:${mode.id}`,
              title: mode.label,
              detail: mode.description,
              kind: "mode" as const,
              section: "Modes",
              mode: mode.id,
              isCurrent: mode.id === currentMode,
            },
          ];
        });
        setItems([...commandItems, ...modeItems]);
        setSelectedIndex(0);
        setMenuStatus("idle");
      };
      if (commandsRef.current !== null) {
        supply(commandsRef.current);
        return;
      }
      if (client === null || client === undefined) {
        commandsRef.current = localCommands;
        supply(localCommands);
        return;
      }
      const location = _directory === undefined ? undefined : { directory: _directory };
      setMenuStatus("loading");
      void Promise.all([client.commands.list(location), client.skills.list(location)])
        .then(([commandResult, skillResult]) => {
          const skills = skillResult.data.filter((skill) => skill.slash !== false);
          skillNamesRef.current = new Set(skills.map((skill) => skill.name));
          const skillCommands: ComposerCommand[] = skills.map((skill) => ({
            name: skill.name,
            description: skill.description ?? "",
            agent: null,
            model: null,
            template: skill.content,
            subtask: false,
            location: skill.location,
          }));
          const commands = [
            ...skillCommands,
            ...localCommands,
            ...commandResult.data.flatMap((command) =>
              [...skillCommands, ...localCommands].some((local) => local.name === command.name)
                ? []
                : [
                    {
                      name: command.name,
                      description: command.description ?? "",
                      agent: command.agent ?? null,
                      model:
                        command.model === undefined
                          ? null
                          : `${command.model.providerID}/${command.model.id}`,
                      template: command.template,
                      subtask: command.subtask ?? false,
                      location: null,
                    },
                  ],
            ),
          ];
          commandsRef.current = commands;
          supply(commands);
        })
        .catch(() => {
          if (fetchSeq.current === seq) setMenuStatus("error");
        });
      return;
    }

    if (trigger.kind === "source") {
      const browser = readDesktopBrowserAvailability();
      const sourceItems: MenuItem[] = [
        ...(isRepository
          ? [
              {
                key: "source:branch",
                title: "Branch",
                detail: "Reference the current branch diff",
                kind: "branch" as const,
              },
            ]
          : []),
        ...(browser.status === "ready"
          ? [
              {
                key: "source:browser",
                title: "Browser",
                detail: "Ask the agent to use browser tools",
                kind: "browser" as const,
              },
            ]
          : []),
        {
          key: "source:files",
          title: "Files & Folders",
          detail: "Reference project files and folders",
          kind: "source-files",
        },
        {
          key: "source:chats",
          title: "Past Chats",
          detail: "Attach context from an earlier chat",
          kind: "source-chats",
        },
      ];
      const query = trigger.query.toLowerCase();
      setItems(
        sourceItems.filter(
          (item) =>
            item.title.toLowerCase().includes(query) || item.detail?.toLowerCase().includes(query),
        ),
      );
      setSelectedIndex(0);
      setMenuStatus("idle");
      return;
    }

    if (trigger.kind === "chat") {
      const query = trigger.query.toLowerCase();
      const chatItems: readonly MenuItem[] = sessions
        .filter(
          (session) =>
            session.server === client?.server.key && session.title.toLowerCase().includes(query),
        )
        .slice(0, MENU_MAX_ITEMS)
        .map((session) => ({
          key: `chat:${session.server}:${session.id}`,
          title: session.title,
          detail: basename(session.projectDirectory),
          kind: "chat",
          sessionID: session.id,
          server: session.server,
        }));
      setItems([
        {
          key: "back:source",
          title: "Back",
          detail: null,
          kind: "back",
          section: "Past Chats",
        },
        ...chatItems,
      ]);
      setSelectedIndex(chatItems.length === 0 ? 0 : 1);
      setMenuStatus("idle");
      return;
    }

    // Debounce file searches. Each query aborts the previous request; stalled searches retry once.
    setMenuStatus("loading");
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (client === null || client === undefined) {
        if (fetchSeq.current === seq) closeMenu();
        return;
      }
      const controller = new AbortController();
      fileSearchRef.current = controller;
      void findFileSuggestions({
        files: client.files,
        query: trigger.query,
        signal: controller.signal,
        ...(_directory === undefined ? {} : { directory: _directory }),
      }).then((result) => {
        if (fileSearchRef.current === controller) fileSearchRef.current = null;
        if (fetchSeq.current !== seq || controller.signal.aborted) return;
        if (result === null) {
          closeMenu();
          return;
        }
        const fileItems: readonly MenuItem[] = result.data.map((file) => ({
          key: `${file.type}:${file.path}`,
          title: basename(file.path),
          detail: file.path,
          kind: file.type === "directory" ? "folder" : "file",
          path: file.path,
        }));
        setItems([
          {
            key: "back:source",
            title: "Back",
            detail: null,
            kind: "back",
            section: "Files & Folders",
          },
          ...fileItems,
        ]);
        setSelectedIndex(fileItems.length === 0 ? 0 : 1);
        setMenuStatus("idle");
      });
    }, FILE_SEARCH_DEBOUNCE_MS);
  };

  const syncTrigger = (): void => {
    const detected = editor
      .getEditorState()
      .read((): { readonly trigger: MenuTrigger; readonly leadOffset: number } | null => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return null;
        }
        const node = selection.anchor.getNode();
        if (!$isTextNode(node)) {
          return null;
        }
        const before = node.getTextContent().slice(0, selection.anchor.offset);
        // The lead offset is the trigger character itself, so the menu lines up with "/" or "@".
        const leadOffset = (match: RegExpExecArray): number =>
          selection.anchor.offset - (match[2]?.length ?? 0) - 1;
        // Open the slash menu at the start of a word. Submission runs only a leading /token.
        const slash = /(^|\s)\/([\w:.-]*)$/.exec(before);
        if (slash !== null) {
          if (
            (client === null || client === undefined) &&
            localCommands.length === 0 &&
            modes.length === 0
          ) {
            return null;
          }
          return {
            trigger: { kind: "command", query: slash[2] ?? "" },
            leadOffset: leadOffset(slash),
          };
        }
        const at = /(^|\s)@([^\s@]*)$/.exec(before);
        if (at !== null) {
          if (client === null || client === undefined) {
            return null;
          }
          const query = at[2] ?? "";
          const activeMentionKind = menuRef.current?.kind;
          const kind =
            activeMentionKind === "chat" || activeMentionKind === "file"
              ? activeMentionKind
              : query.length > 0
                ? "file"
                : "source";
          return { trigger: { kind, query }, leadOffset: leadOffset(at) };
        }
        return null;
      });
    if (detected === null) {
      if (menuRef.current !== null) {
        closeMenu();
      }
      return;
    }
    // A fresh anchor per edit: the positioner only recomputes when it is handed a different object.
    // A detached token has no honest origin, so hide the menu until Lexical supplies a live range.
    const range = triggerRange(detected.leadOffset);
    if (range === null || triggerRect(range).height <= 0) {
      fetchSeq.current += 1;
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      menuAnchorRef.current = null;
      itemsRef.current = [];
      selectedIndexRef.current = 0;
      setMenuAnchor(null);
      setItems([]);
      setSelectedIndex(0);
      setMenuStatus("idle");
      return;
    }
    const root = editor.getRootElement();
    const anchor = {
      getBoundingClientRect: () => triggerRect(range),
      ...(root === null ? {} : { contextElement: root }),
    };
    menuAnchorRef.current = anchor;
    setMenuAnchor(anchor);
    openFor(detected.trigger);
  };

  // Insert Lexical nodes so submission can recover mentions and attached files.
  const applyItem = (item: MenuItem): void => {
    const current = menuRef.current;
    if (current === null) {
      return;
    }

    const replaceTrigger = (
      trigger: "@" | "/",
      insert: (range: ReturnType<typeof $getSelection>) => void,
    ): void => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
        const node = selection.anchor.getNode();
        if (!$isTextNode(node)) return;
        const before = node.getTextContent().slice(0, selection.anchor.offset);
        const match =
          trigger === "@" ? /(^|\s)@([^\s@]*)$/.exec(before) : /(^|\s)\/([\w:.-]*)$/.exec(before);
        if (match === null) return;
        node.select(selection.anchor.offset - (match[2]?.length ?? 0) - 1, selection.anchor.offset);
        insert($getSelection());
      });
    };

    const insertContext = (payload: ContextPayload): NodeKey | null => {
      let nodeKey: NodeKey | null = null;
      replaceTrigger("@", (range) => {
        if (!$isRangeSelection(range)) return;
        const node = $createContextNode(payload);
        nodeKey = node.getKey();
        range.insertNodes([node, $createTextNode(" ")]);
      });
      return nodeKey;
    };

    if (item.kind === "back") {
      replaceTrigger("@", (range) => {
        if ($isRangeSelection(range)) range.insertText("@");
      });
      openFor({ kind: "source", query: "" });
      editor.focus();
      notifyContent();
      return;
    }

    if (item.kind === "source-files") {
      replaceTrigger("@", (range) => {
        if ($isRangeSelection(range)) range.insertText("@");
      });
      openFor({ kind: "file", query: "" });
      editor.focus();
      notifyContent();
      return;
    }
    if (item.kind === "source-chats") {
      replaceTrigger("@", (range) => {
        if ($isRangeSelection(range)) range.insertText("@");
      });
      openFor({ kind: "chat", query: "" });
      editor.focus();
      notifyContent();
      return;
    }
    if (item.kind === "mode") {
      replaceTrigger("/", (range) => {
        if ($isRangeSelection(range)) range.insertText("");
      });
      // Picking the mode you are already in turns it off rather than re-arming it.
      onModeSelect?.(item.mode === currentMode ? DEFAULT_MODE : item.mode);
      notifyContent();
      closeMenu();
      return;
    }
    if (item.kind === "browser") {
      replaceTrigger("@", (range) => {
        if (!$isRangeSelection(range)) return;
        range.insertNodes([
          $createMentionNode({ kind: "browser", path: "browser", label: "Browser" }),
          $createTextNode(" "),
        ]);
      });
      notifyContent();
      closeMenu();
      return;
    }
    if (item.kind === "branch") {
      closeMenu();
      if (client !== null && client !== undefined && _directory !== undefined) {
        const nodeKey = insertContext({
          kind: "branch",
          sourceKey: `branch:${_directory}`,
          label: "Current branch diff",
          path: null,
          mime: "text/plain",
        });
        if (nodeKey === null) return;
        const read = client.vcs
          .diff({ directory: _directory, mode: "branch" })
          .then((files) => {
            const content = files
              .map(
                (file) =>
                  `# ${file.file} (+${String(file.additions)} -${String(file.deletions)})\n${file.patch ?? ""}`,
              )
              .join("\n\n");
            updateContextPath(nodeKey, formatInlineContextDataUrl("branch", content));
          })
          .catch((error: unknown) => {
            removeContext(nodeKey);
            toastActions.add({
              type: "error",
              title: "Couldn’t add branch context",
              description: errorMessage(error),
            });
          })
          .finally(() => {
            pendingReadsRef.current = pendingReadsRef.current.filter((entry) => entry !== read);
          });
        trackPendingRead(read);
      }
      return;
    }
    if (
      item.kind === "chat" &&
      item.sessionID !== undefined &&
      item.server !== undefined &&
      client !== null &&
      client !== undefined
    ) {
      const nodeKey = insertContext({
        kind: "chat",
        sourceKey: `chat:${item.server}:${item.sessionID}`,
        label: item.title,
        path: null,
        mime: "text/plain",
      });
      closeMenu();
      if (nodeKey === null) return;
      const read = client.sessions
        .transcript(openCodeSessionRef(item.server, item.sessionID))
        .then((transcript) => {
          const roles = new Map(transcript.messages.map((message) => [message.id, message.role]));
          const content = transcript.parts
            .flatMap((part) =>
              part.type === "text"
                ? [`${roles.get(part.messageID) ?? "message"}: ${part.text}`]
                : [],
            )
            .join("\n\n");
          updateContextPath(nodeKey, formatInlineContextDataUrl("chat", content));
        })
        .catch((error: unknown) => {
          removeContext(nodeKey);
          toastActions.add({
            type: "error",
            title: "Couldn’t add chat context",
            description: errorMessage(error),
          });
        })
        .finally(() => {
          pendingReadsRef.current = pendingReadsRef.current.filter((entry) => entry !== read);
        });
      trackPendingRead(read);
      return;
    }
    if (current.kind === "file" && item.kind === "folder") {
      const path = item.path ?? item.key;
      replaceTrigger("@", (range) => {
        if (!$isRangeSelection(range)) return;
        range.insertNodes([
          $createMentionNode({ kind: "folder", path, label: basename(path) }),
          $createTextNode(" "),
        ]);
      });
    } else if (current.kind === "file" && item.kind === "file") {
      const mention = item.mention;
      const path = item.path ?? item.key;
      const mime = mention === undefined ? mimeFromPath(path) : undefined;
      replaceTrigger("@", (range) => {
        if ($isRangeSelection(range)) {
          range.insertNodes([
            $createMentionNode(
              mention ?? {
                path,
                label: basename(path),
                ...(mime !== undefined ? { mime } : {}),
              },
            ),
            $createTextNode(" "),
          ]);
        }
      });
    } else if (item.command !== undefined && onCommandSelect?.(item.command.name) === true) {
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
          range.insertText("");
        }
      });
      notifyContent();
      closeMenu();
      return;
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
            $createCommandNode({
              name: item.command?.name ?? item.title,
              description: item.detail,
              // Embed the skill path now, while the ComposerCommand is in hand, so submit no longer
              // depends on the skill list having finished loading. Plain commands stay path-less.
              path: item.command?.location ?? null,
            }),
            $createTextNode(" "),
          ]);
        }
      });
    }
    editor.focus();
    notifyContent();
    closeMenu();
  };

  const submit = (options?: {
    readonly retryAfterRead?: boolean;
    readonly sendNow?: boolean;
  }): void => {
    // Wait for pasted files, then submit again. The pending list clears before the second attempt.
    if (
      waitForPendingReads(pendingReadsRef.current, () =>
        submitRef.current({ ...options, retryAfterRead: true }),
      )
    ) {
      return;
    }
    const serialized = serializePrompt(editor);
    const text = serialized.text.trim();
    const sourceOffset = serialized.text.length - serialized.text.trimStart().length;
    // Combine file mentions with pasted, dropped, and selected files.
    const files: PromptComposerFile[] = [
      ...serialized.mentions.map((mention) => promptFileFromMention(mention, sourceOffset)),
      ...serialized.contexts.flatMap((context) =>
        context.path === null
          ? []
          : [
              {
                path: context.path,
                filename: context.label,
                mime: context.mime,
                context: { kind: context.kind, sourceKey: context.sourceKey },
              },
            ],
      ),
      ...attachmentsRef.current.map((attachment) => ({
        path: attachment.path,
        filename: attachment.label,
        ...(attachment.mime !== undefined ? { mime: attachment.mime } : {}),
      })),
    ];
    if (!hasSubmittablePrompt(text, files.length)) {
      if (options?.retryAfterRead !== true) onEmptySubmit?.();
      return;
    }
    const command = classifyPromptCommand({
      text,
      fileCount: files.length,
      localCommands,
      serverCommands: commandsRef.current ?? [],
    });
    const serverCommand =
      command === null || localCommands.some((local) => local.name === command.name)
        ? undefined
        : commandsRef.current?.find((candidate) => candidate.name === command.name);
    const clear = (): void => {
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        root.append($createParagraphNode());
      });
      setAttachmentList([]);
      onDraftChange?.({ text: "", files: [] });
      closeMenu();
    };
    const result = onSubmit({
      text:
        serverCommand === undefined || command === null
          ? text
          : serverCommand.location !== null
            ? [formatSkillReference(serverCommand.name, serverCommand.location), command.arguments]
                .filter((part) => part.length > 0)
                .join(" ")
            : expandPromptCommandTemplate(serverCommand.template, command.arguments),
      files,
      editorState: JSON.stringify(editor.getEditorState()),
      command: serverCommand === undefined ? command : null,
      sendNow: options?.sendNow === true,
    });
    if (result === false) return;
    if (result === undefined || result === true) {
      clear();
      return;
    }
    editor.setEditable(false);
    void result
      .then(
        (accepted) => {
          if (accepted === false) return;
          onDraftChange?.({ text: "", files: [] });
          if (editor.getRootElement() !== null) clear();
        },
        () => undefined,
      )
      .finally(() => {
        if (editor.getRootElement() !== null) editor.setEditable(true);
      });
  };

  const handleChange = (): void => {
    const draft = currentDraft();
    isSubmittableRef.current = draft.text.trim().length > 0 || draft.files.length > 0;
    setIsEmpty(draft.text.length === 0 && !draft.files.some((file) => file.context !== undefined));
    onHasTextChange?.(draft.text.trim().length > 0 || draft.files.length > 0);
    onDraftChange?.(draft);
    reportNeedsExpansion();
    syncTrigger();
  };

  // Keep the values read by the editor listeners current.
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
      // Focus-on-type appends at the end of the draft so a stolen keystroke never splits prior text.
      insertText: (text) => {
        editor.update(() => {
          $getRoot().selectEnd().insertText(text);
        });
        editor.focus();
      },
      // Editing a queued message replaces the whole draft, text and attachments.
      setDraft: (draft) => {
        if (draft.editorState === undefined) {
          editor.update(() => {
            replaceEditorDraft(draft);
            $getRoot().selectEnd();
          });
        } else {
          editor.setEditorState(editor.parseEditorState(draft.editorState));
        }
        setAttachmentList(
          physicalAttachmentsFromPromptFiles(draft.files, "queued", draft.editorState),
        );
        editor.focus();
      },
      chooseImages: () => imageInputRef.current?.click(),
    };
  }

  // Register the update listener and keyboard commands when the editor mounts.
  const disposeRef = React.useRef<(() => void) | null>(null);
  const registerEditor = React.useCallback(
    (node: HTMLDivElement | null): void => {
      if (node === null) {
        disposeRef.current?.();
        disposeRef.current = null;
        return;
      }
      // Measure again when the editor width changes.
      const root = editor.getRootElement();
      if (autoFocus) {
        editor.focus();
      }
      const resize =
        root !== null && typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(() => {
              reportNeedsExpansionRef.current();
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
            if (
              menuAnchorRef.current !== null &&
              menuRef.current !== null &&
              itemsRef.current.length > 0
            ) {
              event?.preventDefault();
              const item = itemsRef.current[selectedIndexRef.current];
              if (item !== undefined) {
                applyItemRef.current(item);
              }
              return true;
            }
            if (event !== null && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              submitRef.current({ sendNow: event.metaKey || event.ctrlKey });
              return true;
            }
            return false;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_ARROW_DOWN_COMMAND,
          (event) => {
            if (
              menuAnchorRef.current === null ||
              menuRef.current === null ||
              itemsRef.current.length === 0
            ) {
              return false;
            }
            event?.preventDefault();
            setIsKeyboardNavigation(true);
            setSelectedIndex((index) => (index + 1) % itemsRef.current.length);
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_ARROW_UP_COMMAND,
          (event) => {
            if (menuAnchorRef.current === null || menuRef.current === null) {
              if (
                menuAnchorRef.current !== null ||
                menuRef.current !== null ||
                isSubmittableRef.current ||
                onEmptyArrowUpRef.current?.() !== true
              ) {
                return false;
              }
              event?.preventDefault();
              return true;
            }
            if (itemsRef.current.length === 0) return false;
            event?.preventDefault();
            setIsKeyboardNavigation(true);
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
            if (
              menuAnchorRef.current !== null &&
              (menuRef.current?.kind === "chat" || menuRef.current?.kind === "file")
            ) {
              applyItemRef.current({
                key: "back:source",
                title: "Back",
                detail: null,
                kind: "back",
              });
              return true;
            }
            if (menuAnchorRef.current !== null && menuRef.current !== null) {
              closeMenu();
              return true;
            }
            if (onEscapeRef.current === undefined) return false;
            onEscapeRef.current();
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        registerChipDeletion(editor),
        editor.registerCommand(
          KEY_TAB_COMMAND,
          (event) => {
            if (
              menuAnchorRef.current === null ||
              menuRef.current === null ||
              itemsRef.current.length === 0
            ) {
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
        fetchSeq.current += 1;
        if (debounceRef.current !== null) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        fileSearchRef.current?.abort();
        fileSearchRef.current = null;
        disposeListeners();
        resize?.disconnect();
      };
      handleChangeRef.current();
    },
    [autoFocus, editor],
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
      {menu !== null && menuAnchor !== null && (
        <PromptMenu
          anchor={menuAnchor}
          items={items}
          selectedIndex={selectedIndex}
          placement={menuPlacement}
          listboxId={menuId}
          isLoading={menuStatus === "loading"}
          emptyLabel={
            menuStatus === "loading"
              ? "Loading suggestions…"
              : menuStatus === "error"
                ? "Couldn’t load suggestions"
                : menu.kind === "file"
                  ? "No matching files or folders"
                  : menu.kind === "chat"
                    ? "No matching chats"
                    : "No matching commands"
          }
          onSelect={applyItem}
          onHighlight={(index) => {
            setIsKeyboardNavigation(false);
            setSelectedIndex(index);
          }}
          isKeyboardNavigation={isKeyboardNavigation}
        />
      )}

      <AttachmentList
        attachments={attachments}
        style={attachmentsStyle}
        onRemove={(key) => {
          setAttachmentList(attachmentsRef.current.filter((entry) => entry.key !== key));
        }}
      />
      <div
        ref={registerEditor}
        {...stylex.props(styles.editorShell)}
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
              aria-autocomplete="list"
              aria-expanded={menu !== null}
              aria-controls={menu === null ? undefined : menuId}
              aria-activedescendant={
                menu === null || items[selectedIndex] === undefined
                  ? undefined
                  : `${menuId}-option-${String(selectedIndex)}`
              }
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
