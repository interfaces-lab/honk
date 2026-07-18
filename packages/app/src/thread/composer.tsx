import * as stylex from "@stylexjs/stylex";
import { Text } from "@honk/ui";
import { radiusVars, spaceVars, workbenchSurfaceVars, zVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { ComposerAttachmentButton, ModeControl } from "../composer/controls";
import { readComposerDraft, writeComposerDraft } from "../composer/draft-store";
import { PromptEditor } from "../composer/prompt-editor";
import { ComposerSubmitButton } from "../composer/submit-button";
import type { PromptEditorHandle, PromptSubmit } from "../composer/types";
import { DirectoryAccessControl } from "../directory-access-control";
import { canPickFolder, pickFolder } from "../desktop-bridge";
import { errorMessage } from "../error-message";
import { actions as modeActions, modeAgentName, nextModeId, useThreadMode } from "../modes";
import {
  APP_HOST_CAPABILITIES,
  gatedCapabilityError,
  promptFilesFromPaths,
} from "../open-code-view";
import { sendSessionPrompt } from "../session-prompt";
import { actions as toastActions } from "../toast-store";
import { useWorkspaceWatchSelector } from "../use-sdk-watch";
import { useThreadRuntime } from "./runtime";

const EMPTY_DIRECTORIES: readonly string[] = Object.freeze([]);
const DIRECTORY_ACCESS_BUSY_MESSAGE =
  "Can't change folder access while the agent is working. Stop the run and try again.";
const THREAD_COMMANDS = [
  {
    name: "cd",
    description: "Allow access to an external directory",
    agent: null,
    model: null,
    template: "",
    subtask: false,
  },
] as const;
const COMPOSER_COLLAPSED_PADDING_INLINE_PX = 10;
const COMPOSER_COLLAPSED_PADDING_INLINE = `${COMPOSER_COLLAPSED_PADDING_INLINE_PX}px`;
// The absolute composer shares the transcript's root gutter plus its scrollport inset.
const COMPOSER_OVERLAY_INLINE_INSET = `calc(${spaceVars["--honk-space-gutter"]} + ${spaceVars["--honk-space-panel-pad"]})`;
const COMPOSER_EDITOR_LINE_HEIGHT = "20px";
const COMPOSER_EDITOR_COLLAPSED_PADDING_INLINE = "4px";
const COMPOSER_CONTROLS_EXPANDED_PADDING_BLOCK = "6px";
const COMPOSER_RING = `inset 0 0 0 1px ${workbenchSurfaceVars["--honk-workbench-input-border"]}`;
const COMPOSER_RING_ACTIVE = `inset 0 0 0 1px ${workbenchSurfaceVars["--honk-workbench-input-border-active"]}`;
// 96px of the panel stays visible above a fully grown composer.
const COMPOSER_OVERLAY_MAX_HEIGHT = "calc(100% - 96px)";
const styles = stylex.create({
  composerCollapsed: {
    minHeight: "44px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: COMPOSER_COLLAPSED_PADDING_INLINE,
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: workbenchSurfaceVars["--honk-workbench-input-background"],
    boxShadow: {
      default: COMPOSER_RING,
      ":hover": { "@media (hover: hover)": COMPOSER_RING_ACTIVE },
      ":focus-within": COMPOSER_RING_ACTIVE,
    },
  },
  composerExpanded: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: workbenchSurfaceVars["--honk-workbench-input-background"],
    boxShadow: {
      default: COMPOSER_RING,
      ":hover": { "@media (hover: hover)": COMPOSER_RING_ACTIVE },
      ":focus-within": COMPOSER_RING_ACTIVE,
    },
  },
  composerOverlay: {
    position: "absolute",
    zIndex: zVars["--honk-z-stage-float"],
    insetInlineStart: COMPOSER_OVERLAY_INLINE_INSET,
    insetInlineEnd: COMPOSER_OVERLAY_INLINE_INSET,
    insetBlockEnd: spaceVars["--honk-space-panel-pad"],
    // Cap growth against the thread panel so a long reply keeps a strip of transcript visible and
    // never runs past the window; the editor scrolls internally once this binds.
    maxHeight: COMPOSER_OVERLAY_MAX_HEIGHT,
  },
  editorContainerCollapsed: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  editorContainerExpanded: { width: "100%" },
  editorCollapsed: {
    minHeight: COMPOSER_EDITOR_LINE_HEIGHT,
    maxHeight: "120px",
    paddingTop: 0,
    paddingBottom: 0,
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px collapsed-editor inline padding is fixed geometry, no spacing token owns 4px
    paddingInline: COMPOSER_EDITOR_COLLAPSED_PADDING_INLINE,
    // oxlint-disable-next-line honk/design-no-raw-values -- 20px editor line-height is a fixed intrinsic, no body-leading token matches (leading-body is 18px)
    lineHeight: COMPOSER_EDITOR_LINE_HEIGHT,
  },
  editorExpanded: {
    minHeight: COMPOSER_EDITOR_LINE_HEIGHT,
    // Screen-level backstop; the overlay's panel-relative maxHeight is the real bound.
    maxHeight: "calc(100dvh - 120px)",
    paddingTop: spaceVars["--honk-space-gutter"],
    paddingBottom: 0,
    paddingInline: spaceVars["--honk-space-panel-pad"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 20px editor line-height is a fixed intrinsic, no body-leading token matches (leading-body is 18px)
    lineHeight: COMPOSER_EDITOR_LINE_HEIGHT,
  },
  placeholderCollapsed: {
    insetInlineStart: COMPOSER_EDITOR_COLLAPSED_PADDING_INLINE,
    insetBlockStart: 0,
    // oxlint-disable-next-line honk/design-no-raw-values -- 20px placeholder line-height matches the editor's fixed intrinsic, no body-leading token matches (leading-body is 18px)
    lineHeight: COMPOSER_EDITOR_LINE_HEIGHT,
  },
  placeholderExpanded: {
    insetInlineStart: spaceVars["--honk-space-panel-pad"],
    insetBlockStart: spaceVars["--honk-space-gutter"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 20px placeholder line-height matches the editor's fixed intrinsic, no body-leading token matches (leading-body is 18px)
    lineHeight: COMPOSER_EDITOR_LINE_HEIGHT,
  },
  controlsCollapsed: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  controlsExpanded: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 6px controls-row block padding is fixed geometry, control-gap is a gap token not a padding token
    paddingBlock: COMPOSER_CONTROLS_EXPANDED_PADDING_BLOCK,
    paddingInline: COMPOSER_COLLAPSED_PADDING_INLINE,
  },
});

export function ThreadComposer({
  children,
  formRef,
  threadId,
  isRunning,
  cwd,
  attachedDirectories,
}: {
  children?: React.ReactNode;
  formRef: React.RefCallback<HTMLFormElement>;
  threadId: string;
  isRunning: boolean;
  cwd: string;
  attachedDirectories: readonly string[];
}): React.ReactElement {
  const runtime = useThreadRuntime();
  const mode = useThreadMode(runtime.tabKey);
  const [initialDraft] = React.useState(() => readComposerDraft(runtime.tabKey));
  const recentDirectories = useWorkspaceWatchSelector(
    (snapshot) => snapshot.state?.recentDirectories ?? EMPTY_DIRECTORIES,
  );
  const [hasText, setHasText] = React.useState(false);
  const [isSending, setSending] = React.useState(false);
  const [isDirectoryPickerOpen, setDirectoryPickerOpen] = React.useState(false);
  const [isUpdatingDirectories, setUpdatingDirectories] = React.useState(false);
  // Expand the composer when the editor wraps onto another line.
  const [expanded, setExpanded] = React.useState(false);
  const composerExpanded = expanded;
  const editorRef = React.useRef<PromptEditorHandle | null>(null);
  const formElementRef = React.useRef<HTMLFormElement | null>(null);
  const controlsElementRef = React.useRef<HTMLDivElement | null>(null);
  const attachForm: React.RefCallback<HTMLFormElement> = (element) => {
    formElementRef.current = element;
    const detach = formRef(element);
    if (element === null) {
      return;
    }

    return () => {
      formElementRef.current = null;
      if (typeof detach === "function") {
        detach();
      } else {
        formRef(null);
      }
    };
  };

  // Use the compact width to decide whether text wraps. The expanded width would reverse the result.
  const measureCompactEditorWidth = (): number | null => {
    const form = formElementRef.current;
    const controls = controlsElementRef.current;
    if (form === null || controls === null) {
      return null;
    }

    const controlsStyle = window.getComputedStyle(controls);
    const gap = Number.parseFloat(controlsStyle.columnGap) || 0;
    const compactChildren = Array.from(controls.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !child.hasAttribute("data-composer-expanded-only"),
    );
    const controlsWidth = compactChildren.reduce(
      (width, child) => width + child.getBoundingClientRect().width,
      gap * Math.max(0, compactChildren.length - 1),
    );
    const width =
      form.getBoundingClientRect().width -
      COMPOSER_COLLAPSED_PADDING_INLINE_PX * 2 -
      gap -
      controlsWidth;
    return width > 0 ? width : null;
  };

  const reportDirectoryError = (error: unknown): void => {
    const message = errorMessage(error);
    toastActions.add({
      type: "error",
      title: "Folder access failed",
      description: message,
      copyableError: message,
      threadKey: runtime.tabKey,
    });
  };

  const canChangeDirectories = (): boolean => {
    if (!isRunning) {
      return true;
    }
    reportDirectoryError(new Error(DIRECTORY_ACCESS_BUSY_MESSAGE));
    return false;
  };

  const requestDirectoryPicker = (open: boolean): void => {
    if (!open) {
      setDirectoryPickerOpen(false);
      return;
    }
    if (canChangeDirectories()) {
      setDirectoryPickerOpen(true);
    }
  };

  const attachDirectory = (_path: string): void => {
    if (!APP_HOST_CAPABILITIES.directoryAttach) {
      reportDirectoryError(gatedCapabilityError("Folder access changes"));
      return;
    }
    if (!canChangeDirectories() || isUpdatingDirectories) {
      return;
    }
    const client = runtime.client;
    if (client === null) {
      reportDirectoryError(new Error("The OpenCode connection is not ready yet."));
      return;
    }
    setUpdatingDirectories(true);
    void Promise.reject(gatedCapabilityError("Folder access changes"))
      .catch(reportDirectoryError)
      .finally(() => {
        setUpdatingDirectories(false);
      });
  };

  const detachDirectory = (_path: string): void => {
    if (!APP_HOST_CAPABILITIES.directoryAttach) {
      reportDirectoryError(gatedCapabilityError("Folder access changes"));
      return;
    }
    if (!canChangeDirectories() || isUpdatingDirectories) {
      return;
    }
    const client = runtime.client;
    if (client === null) {
      reportDirectoryError(new Error("The OpenCode connection is not ready yet."));
      return;
    }
    setUpdatingDirectories(true);
    void Promise.reject(gatedCapabilityError("Folder access changes"))
      .catch(reportDirectoryError)
      .finally(() => {
        setUpdatingDirectories(false);
      });
  };

  const browseForDirectory = (): void => {
    if (!canChangeDirectories() || isUpdatingDirectories) {
      return;
    }
    void pickFolder(cwd).then((path) => {
      if (path !== null) {
        attachDirectory(path);
      }
    });
  };

  const handleSubmit = (payload: PromptSubmit): boolean | Promise<boolean> => {
    if (isSending) return false;
    const client = runtime.client;
    if (client === null) {
      toastActions.add({
        type: "error",
        title: "Not connected",
        description: "The OpenCode connection is not ready yet.",
        threadKey: runtime.tabKey,
      });
      return false;
    }

    if (payload.command?.name === "cd") {
      if (payload.command.arguments.length === 0) {
        requestDirectoryPicker(true);
      } else {
        attachDirectory(payload.command.arguments);
      }
      return true;
    }

    setSending(true);
    const work =
      payload.command !== null
        ? Promise.reject(gatedCapabilityError("Slash commands"))
        : sendSessionPrompt(client, threadId, {
            text: payload.text,
            agent: modeAgentName(mode),
            ...(payload.files.length > 0 ? { files: promptFilesFromPaths(payload.files) } : {}),
          });
    return work
      .then(() => true)
      .catch((error: unknown) => {
        const message = errorMessage(error);
        toastActions.add({
          type: "error",
          title: payload.command !== null ? "Command failed" : "Send failed",
          description: message,
          copyableError: message,
          threadKey: runtime.tabKey,
        });
        return false;
      })
      .finally(() => {
        setSending(false);
      });
  };

  return (
    <form
      ref={attachForm}
      {...stylex.props(
        styles.composerOverlay,
        composerExpanded ? styles.composerExpanded : styles.composerCollapsed,
      )}
      onSubmit={(event) => {
        event.preventDefault();
        editorRef.current?.submit();
      }}
      onKeyDown={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("[data-directory-picker]") !== null
        ) {
          return;
        }
        if (event.key === "Tab" && event.shiftKey && !event.defaultPrevented) {
          event.preventDefault();
          modeActions.setThreadMode(runtime.tabKey, nextModeId(mode));
        }
      }}
    >
      {children}
      <PromptEditor
        placeholder="Reply…"
        ariaLabel="Reply"
        directory={cwd}
        localCommands={APP_HOST_CAPABILITIES.directoryAttach ? THREAD_COMMANDS : []}
        onCommandSelect={(name) => {
          if (name === "cd") {
            requestDirectoryPicker(true);
            return true;
          }
          return false;
        }}
        onSubmit={handleSubmit}
        onHasTextChange={setHasText}
        onDraftChange={(draft) => writeComposerDraft(runtime.tabKey, draft)}
        onMultilineChange={setExpanded}
        multilineMeasureWidth={measureCompactEditorWidth}
        multilineMeasureStyle={styles.editorCollapsed}
        containerStyle={
          composerExpanded ? styles.editorContainerExpanded : styles.editorContainerCollapsed
        }
        editorStyle={composerExpanded ? styles.editorExpanded : styles.editorCollapsed}
        placeholderStyle={
          composerExpanded ? styles.placeholderExpanded : styles.placeholderCollapsed
        }
        {...(initialDraft === undefined ? {} : { initialDraft })}
        handleRef={editorRef}
      />
      <div
        ref={controlsElementRef}
        {...stylex.props(composerExpanded ? styles.controlsExpanded : styles.controlsCollapsed)}
      >
        <ComposerAttachmentButton editorRef={editorRef} />
        {APP_HOST_CAPABILITIES.directoryAttach ? (
          <DirectoryAccessControl
            cwd={cwd}
            attachedDirectories={attachedDirectories}
            recentDirectories={recentDirectories}
            isOpen={isDirectoryPickerOpen}
            isPending={isUpdatingDirectories}
            canBrowse={canPickFolder()}
            onOpenChange={requestDirectoryPicker}
            onAttach={attachDirectory}
            onDetach={detachDirectory}
            onBrowse={browseForDirectory}
          />
        ) : null}
        <ModeControl
          value={mode}
          onValueChange={(id) => {
            modeActions.setThreadMode(runtime.tabKey, id);
          }}
        />
        {composerExpanded ? (
          <Text
            size="xs"
            tone="faint"
            style={{ flexGrow: 1, minWidth: 0 }}
            data-composer-expanded-only=""
          >
            {isRunning ? "The agent is working. A new prompt will steer it." : ""}
          </Text>
        ) : null}
        <ComposerSubmitButton
          type="submit"
          disabled={!hasText || isSending || isUpdatingDirectories}
        />
      </div>
    </form>
  );
}
