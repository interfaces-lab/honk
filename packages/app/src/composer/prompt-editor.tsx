// Lexical editor shared by new threads and replies. Only a leading /token runs as a command.
// "@" opens the file menu.

import * as stylex from "@stylexjs/stylex";
import { basename } from "@honk/shared/paths";
import {
  colorVars,
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
  $createParagraphNode,
  $createTextNode,
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
} from "lexical";
import * as React from "react";

import { classifyPromptCommand, hasSubmittablePrompt, waitForPendingReads } from "./submission";
import type { PromptEditorDraft, PromptEditorHandle, PromptSubmit } from "./types";
import { AttachmentList, attachmentFromFile, mimeFromPath, type Attachment } from "./attachments";
import {
  $createCommandNode,
  $createMentionNode,
  ComposerCommandNode,
  ComposerMentionNode,
  serializePrompt,
  type MentionPayload,
} from "./prompt-editor-nodes";
import {
  APP_HOST_CAPABILITIES,
  type ComposerCommand,
  type PromptComposerFile,
} from "../open-code-view";

const EDITOR_MIN_HEIGHT = "52px";
// Screen-level backstop only. Hosts bound the editor through the flex chain (minHeight: 0 down to
// the scrollable ContentEditable), so the editor grows to the space its host allows and never past
// the viewport.
const EDITOR_MAX_HEIGHT = "calc(100dvh - 120px)";
const EDITOR_PAD_X = "16px";
const EDITOR_PAD_TOP = "16px";
const EDITOR_LEADING = "21px";
const MENU_MAX_HEIGHT = "240px";
const MENU_ROW_HEIGHT = "28px";
const MENU_GUTTER = "6px";
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
    // oxlint-disable-next-line honk/design-no-raw-values -- 21px composer leading has no matching fontVars size/leading pair for body-lg text
    lineHeight: EDITOR_LEADING,
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
    // oxlint-disable-next-line honk/design-no-raw-values -- 21px composer leading has no matching fontVars size/leading pair for body-lg text
    lineHeight: EDITOR_LEADING,
  },
  menu: {
    position: "absolute",
    insetInline: spaceVars["--honk-space-gutter"],
    zIndex: zVars["--honk-z-stage-float"],
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px hairline gap between menu rows is fixed geometry; no spacing token is 1px
    gap: "1px",
    maxHeight: MENU_MAX_HEIGHT,
    overflowY: "auto",
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px menu popover inner inset is fixed geometry; no spacing token is 4px
    padding: "4px",
    boxSizing: "border-box",
    backgroundColor: colorVars["--honk-color-bg-base"],
    borderRadius: radiusVars["--honk-radius-panel"],
    boxShadow: elevationVars["--honk-elevation-floating"],
  },
  menuAbove: {
    bottom: "100%",
    // oxlint-disable-next-line honk/design-no-raw-values -- 6px composer menu offset from its anchor; no composer-surface spacing token owns it
    marginBottom: MENU_GUTTER,
  },
  menuBelow: {
    top: "100%",
    // oxlint-disable-next-line honk/design-no-raw-values -- 6px composer menu offset from its anchor; no composer-surface spacing token owns it
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
  menuRowSelected: { backgroundColor: colorVars["--honk-color-layer-02"] },
  menuRowTitle: { flexShrink: 0, whiteSpace: "nowrap" },
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
});

type MenuTrigger = {
  readonly kind: "file" | "command";
  readonly query: string;
};

type MenuItem = {
  readonly key: string;
  readonly title: string;
  readonly detail: string | null;
  readonly mention?: MentionPayload;
};

export function PromptEditor(props: {
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly autoFocus?: boolean;
  readonly directory?: string;
  readonly localCommands?: readonly ComposerCommand[];
  readonly onCommandSelect?: (name: string) => boolean;
  readonly menuPlacement?: "above" | "below";
  readonly onSubmit: (payload: PromptSubmit) => boolean | void | Promise<boolean | void>;
  readonly onEscape?: () => void;
  readonly onHasTextChange?: (hasText: boolean) => void;
  readonly onDraftChange?: (draft: PromptEditorDraft) => void;
  readonly onMultilineChange?: (multiline: boolean) => void;
  // Measure with the compact width. Measuring after expansion makes the editor flip between layouts.
  readonly multilineMeasureWidth?: () => number | null;
  readonly multilineMeasureStyle?: stylex.StyleXStyles;
  readonly containerStyle?: stylex.StyleXStyles;
  readonly editorStyle?: stylex.StyleXStyles;
  readonly placeholderStyle?: stylex.StyleXStyles;
  readonly initialDraft?: PromptEditorDraft;
  readonly handleRef?: React.MutableRefObject<PromptEditorHandle | null>;
}): React.ReactElement {
  const initialDraft = props.initialDraft;
  const initialConfig: InitialConfigType = {
    namespace: "honk-composer",
    editable: true,
    nodes: [ComposerMentionNode, ComposerCommandNode],
    ...(initialDraft === undefined
      ? {}
      : {
          editorState: () => {
            const root = $getRoot();
            root.clear();
            for (const line of initialDraft.text.split("\n")) {
              root.append($createParagraphNode().append($createTextNode(line)));
            }
          },
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
  localCommands = [],
  onCommandSelect,
  menuPlacement = "above",
  onSubmit,
  onEscape,
  onHasTextChange,
  onDraftChange,
  onMultilineChange,
  multilineMeasureWidth,
  multilineMeasureStyle,
  containerStyle,
  editorStyle,
  placeholderStyle,
  initialDraft,
  handleRef,
}: {
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly autoFocus?: boolean;
  readonly directory?: string;
  // These commands appear before OpenCode commands. Returning true handles the choice locally.
  readonly localCommands?: readonly ComposerCommand[];
  readonly onCommandSelect?: (name: string) => boolean;
  readonly menuPlacement?: "above" | "below";
  readonly onSubmit: (payload: PromptSubmit) => boolean | void | Promise<boolean | void>;
  readonly onEscape?: () => void;
  readonly onHasTextChange?: (hasText: boolean) => void;
  readonly onDraftChange?: (draft: PromptEditorDraft) => void;
  readonly onMultilineChange?: (multiline: boolean) => void;
  readonly multilineMeasureWidth?: () => number | null;
  readonly multilineMeasureStyle?: stylex.StyleXStyles;
  readonly containerStyle?: stylex.StyleXStyles;
  readonly editorStyle?: stylex.StyleXStyles;
  readonly placeholderStyle?: stylex.StyleXStyles;
  readonly initialDraft?: PromptEditorDraft;
  readonly handleRef?: React.MutableRefObject<PromptEditorHandle | null>;
}): React.ReactElement {
  const [editor] = useLexicalComposerContext();
  const onEscapeRef = React.useRef(onEscape);
  onEscapeRef.current = onEscape;
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const [menu, setMenu] = React.useState<MenuTrigger | null>(null);
  const [items, setItems] = React.useState<readonly MenuItem[]>([]);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [attachments, setAttachments] = React.useState<readonly Attachment[]>(() =>
    (initialDraft?.files ?? []).map((file, index) => ({
      key: `draft:${String(index)}:${file.filename ?? "attachment"}`,
      label: file.filename ?? (file.path.startsWith("data:") ? "attachment" : basename(file.path)),
      path: file.path,
      ...(file.mime !== undefined ? { mime: file.mime } : {}),
    })),
  );
  const [isEmpty, setIsEmpty] = React.useState((initialDraft?.text.length ?? 0) === 0);
  // Pasted files finish in separate microtasks. Update this ref before React renders again.
  const attachmentsRef = React.useRef<readonly Attachment[]>(attachments);
  // Lexical registers these listeners once. Refs give them the latest props without re-registering.
  const menuRef = React.useRef<MenuTrigger | null>(null);
  const itemsRef = React.useRef<readonly MenuItem[]>([]);
  const selectedIndexRef = React.useRef(0);
  const handleChangeRef = React.useRef<() => void>(() => {});
  const applyItemRef = React.useRef<(item: MenuItem) => void>(() => {});
  const submitRef = React.useRef<() => void>(() => {});
  // Callers provide compact-layout measurements so wrapping does not change the width being measured.
  const multilineRef = React.useRef(false);
  const reportMultilineRef = React.useRef<() => void>(() => {});
  const multilineMeasureClassName =
    stylex.props(styles.editor, multilineMeasureStyle ?? editorStyle).className ?? "";

  // Measure a detached clone. Changing the live editor would trigger ResizeObserver and make the
  // layout alternate between compact and expanded.
  const reportMultiline = (): void => {
    const root = editor.getRootElement();
    let next = false;
    if (root !== null && (root.textContent ?? "").trim().length > 0) {
      const requestedWidth = multilineMeasureWidth?.() ?? null;
      const liveWidth = root.getBoundingClientRect().width;
      const liveGeometryMatches =
        requestedWidth === null ||
        (Math.abs(liveWidth - requestedWidth) < 0.5 &&
          root.className === multilineMeasureClassName);
      const measure =
        requestedWidth !== null && requestedWidth > 0 && !liveGeometryMatches
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
    if (next !== multilineRef.current) {
      multilineRef.current = next;
      onMultilineChange?.(next);
    }
  };
  reportMultilineRef.current = reportMultiline;

  const currentDraft = (): PromptEditorDraft => {
    const serialized = serializePrompt(editor);
    return {
      text: serialized.text,
      files: [
        ...serialized.mentions.map((mention) => ({
          path: mention.path,
          filename: mention.label,
          ...(mention.mime !== undefined ? { mime: mention.mime } : {}),
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
      const supply = (commands: readonly ComposerCommand[]): void => {
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
      if (localCommands.length === 0) {
        closeMenu();
      } else {
        commandsRef.current = localCommands;
        supply(localCommands);
      }
      return;
    }

    // Debounce file searches and ignore results from older requests.
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      if (fetchSeq.current === seq) closeMenu();
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
      // Open the slash menu at the start of a word. Submission runs only a leading /token.
      const slash = /(^|\s)\/([\w:.-]*)$/.exec(before);
      if (slash !== null) {
        if (!APP_HOST_CAPABILITIES.commandExecution && localCommands.length === 0) {
          return null;
        }
        return { kind: "command", query: slash[2] ?? "" };
      }
      const at = /(^|\s)@([^\s@]*)$/.exec(before);
      if (at !== null) {
        if (!APP_HOST_CAPABILITIES.fileBrowse) {
          return null;
        }
        return { kind: "file", query: at[2] ?? "" };
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

  // Insert Lexical nodes so submission can recover mentions and attached files.
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
    } else if (onCommandSelect?.(item.key) === true) {
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
    // Wait for pasted files, then submit again. The pending list clears before the second attempt.
    if (waitForPendingReads(pendingReadsRef.current, () => submitRef.current())) {
      return;
    }
    const serialized = serializePrompt(editor);
    const text = serialized.text.trim();
    // Combine file mentions with pasted, dropped, and selected files.
    const files: PromptComposerFile[] = [
      ...serialized.mentions.map((mention) => ({
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
    if (!hasSubmittablePrompt(text, files.length)) {
      return;
    }
    const command = classifyPromptCommand({
      text,
      fileCount: files.length,
      localCommands,
      serverCommands: commandsRef.current ?? [],
    });
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
    const result = onSubmit({ text, files, command });
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
    setIsEmpty(draft.text.length === 0);
    onHasTextChange?.(draft.text.trim().length > 0 || draft.files.length > 0);
    onDraftChange?.(draft);
    reportMultiline();
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
            if (menuRef.current !== null) {
              setMenu(null);
              setItems([]);
              setSelectedIndex(0);
              return true;
            }
            if (onEscapeRef.current === undefined) return false;
            onEscapeRef.current();
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
                // Keep focus in the editor while choosing an item.
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
              spellCheck
              className={stylex.props(styles.editor, editorStyle).className}
            />
          }
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <AttachmentList
        attachments={attachments}
        onRemove={(key) => {
          setAttachmentList(attachmentsRef.current.filter((entry) => entry.key !== key));
        }}
      />
    </div>
  );
}
