import * as stylex from "@stylexjs/stylex";
import { AlertDialog, Button } from "@honk/ui";
import { fontVars, radiusVars, spaceVars, workbenchSurfaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { ComposerAttachmentButton, ModeControl } from "../composer/controls";
import { PromptEditor } from "../composer/prompt-editor";
import { ComposerSubmitButton } from "../composer/submit-button";
import type { PromptEditorHandle, PromptSubmit, ThreadMessageEdit } from "../composer/types";
import { errorMessage } from "../error-message";
import { modeAgentName, nextModeId, useThreadMode } from "../modes";
import {
  interruptSession,
  promptFilesFromPaths,
  restoreSessionRevert,
  revertSessionFromMessage,
  sendSessionPrompt,
} from "../open-code-view";
import { actions as toastActions } from "../toast-store";
import { runMessageEdit } from "./message-edit";
import { useThreadRuntime } from "./runtime";

const EDITOR_MAX_HEIGHT = "200px";
// Cursor groups adjacent edit controls at 4px inside the toolbar's 8px main gap.
const EDIT_CONTROL_GAP = "4px";
const COMPOSER_RING = `inset 0 0 0 1px ${workbenchSurfaceVars["--honk-workbench-input-border"]}`;
const COMPOSER_RING_ACTIVE = `inset 0 0 0 1px ${workbenchSurfaceVars["--honk-workbench-input-border-active"]}`;

const styles = stylex.create({
  root: {
    position: "relative",
    width: "100%",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: workbenchSurfaceVars["--honk-workbench-input-background"],
    boxShadow: {
      default: COMPOSER_RING,
      ":hover": { "@media (hover: hover)": COMPOSER_RING_ACTIVE },
      ":focus-within": COMPOSER_RING_ACTIVE,
    },
  },
  editorContainer: { width: "100%" },
  editor: {
    minHeight: "auto",
    maxHeight: EDITOR_MAX_HEIGHT,
    paddingBlock: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
    fontSize: fontVars["--honk-font-size-body-lg"],
    lineHeight: fontVars["--honk-leading-heading"],
  },
  placeholder: {
    insetInlineStart: spaceVars["--honk-space-panel-pad"],
    insetBlockStart: spaceVars["--honk-space-gutter"],
    fontSize: fontVars["--honk-font-size-body-lg"],
    lineHeight: fontVars["--honk-leading-heading"],
  },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-gutter"],
  },
  leadingControls: {
    display: "flex",
    alignItems: "center",
    gap: EDIT_CONTROL_GAP,
  },
  spacer: { flexGrow: 1, minWidth: 0 },
});

export function InlineMessageEditComposer({
  threadId,
  isRunning,
  cwd,
  draft,
  onCancel,
  onSubmitted,
}: {
  readonly threadId: string;
  readonly isRunning: boolean;
  readonly cwd: string;
  readonly draft: ThreadMessageEdit;
  readonly onCancel: () => void;
  readonly onSubmitted: () => void;
}): React.ReactElement {
  const runtime = useThreadRuntime();
  const threadMode = useThreadMode(runtime.tabKey);
  const [mode, setMode] = React.useState(threadMode);
  const editorRef = React.useRef<PromptEditorHandle | null>(null);
  const rootRef = React.useRef<HTMLFormElement | null>(null);
  const sendingRef = React.useRef(false);
  const pendingSubmissionRef = React.useRef<PromptSubmit | null>(null);
  const [hasText, setHasText] = React.useState(false);
  const [isSending, setSending] = React.useState(false);
  const [pendingSubmission, setPendingSubmission] = React.useState<PromptSubmit | null>(null);

  const reportError = (title: string, error: unknown): void => {
    const message = errorMessage(error);
    toastActions.add({
      type: "error",
      title,
      description: message,
      copyableError: message,
      threadKey: runtime.tabKey,
    });
  };

  const cancel = (): void => {
    if (sendingRef.current || pendingSubmissionRef.current !== null) return;
    onCancel();
  };
  const cancelRef = React.useRef(cancel);
  cancelRef.current = cancel;

  React.useEffect(() => {
    const cancelFromOutside = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Node) || rootRef.current?.contains(target) === true) return;
      cancelRef.current();
    };
    document.addEventListener("pointerdown", cancelFromOutside, true);
    document.addEventListener("focusin", cancelFromOutside, true);
    return () => {
      document.removeEventListener("pointerdown", cancelFromOutside, true);
      document.removeEventListener("focusin", cancelFromOutside, true);
    };
  }, []);

  const executeEdit = (payload: PromptSubmit): void => {
    if (sendingRef.current) return;
    const client = runtime.client;
    if (client === null) {
      reportError("Edit failed", new Error("The OpenCode connection is not ready yet."));
      return;
    }

    sendingRef.current = true;
    setSending(true);
    void runMessageEdit({
      messageID: draft.messageID,
      isRunning,
      interrupt: () => interruptSession(client, threadId),
      revert: (messageID) => revertSessionFromMessage(client, threadId, messageID),
      restore: () => restoreSessionRevert(client, threadId),
      send: () =>
        sendSessionPrompt(client, threadId, {
          messageID: draft.messageID,
          text: payload.text,
          agent: modeAgentName(mode),
          ...(payload.files.length > 0 ? { files: promptFilesFromPaths(payload.files) } : {}),
        }),
    })
      .then(() => {
        onSubmitted();
      })
      .catch((error: unknown) => {
        reportError("Edit failed", error);
      })
      .finally(() => {
        sendingRef.current = false;
        setSending(false);
      });
  };

  const submit = (payload: PromptSubmit): void => {
    if (sendingRef.current || pendingSubmissionRef.current !== null || payload.command !== null) {
      return;
    }
    if (!draft.requiresRevertConfirmation) {
      executeEdit(payload);
      return;
    }
    pendingSubmissionRef.current = payload;
    setPendingSubmission(payload);
  };

  const dismissConfirmation = (): void => {
    pendingSubmissionRef.current = null;
    setPendingSubmission(null);
    window.requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
  };

  const confirmRevert = (): void => {
    const payload = pendingSubmissionRef.current;
    if (payload === null) return;
    pendingSubmissionRef.current = null;
    setPendingSubmission(null);
    executeEdit(payload);
  };

  const submitDisabled = !hasText || isSending;

  return (
    <>
      <form
        ref={rootRef}
        {...stylex.props(styles.root)}
        onSubmit={(event) => {
          event.preventDefault();
          editorRef.current?.submit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab" && event.shiftKey && !event.defaultPrevented) {
            event.preventDefault();
            setMode(nextModeId(mode));
          }
        }}
      >
        <PromptEditor
          key={draft.messageID}
          placeholder="Edit message..."
          ariaLabel="Edit message"
          autoFocus
          initialDraft={draft}
          directory={cwd}
          onEscape={cancel}
          onSubmit={submit}
          onHasTextChange={setHasText}
          containerStyle={styles.editorContainer}
          editorStyle={styles.editor}
          placeholderStyle={styles.placeholder}
          handleRef={editorRef}
        />
        <div {...stylex.props(styles.controls)}>
          <div {...stylex.props(styles.leadingControls)}>
            <ComposerAttachmentButton editorRef={editorRef} />
            <ModeControl
              value={mode}
              onValueChange={(id) => {
                setMode(id);
              }}
            />
          </div>
          <div {...stylex.props(styles.spacer)} />
          <ComposerSubmitButton type="submit" ariaLabel="Send message" disabled={submitDisabled} />
        </div>
      </form>
      <AlertDialog.Root
        open={pendingSubmission !== null}
        onOpenChange={(open) => {
          if (!open && pendingSubmissionRef.current !== null) dismissConfirmation();
        }}
      >
        <AlertDialog.Popup>
          <AlertDialog.Header>
            <AlertDialog.Title>Submit from a previous message?</AlertDialog.Title>
            <AlertDialog.Description>
              Submitting from a previous message will revert file changes to before this message and
              clear the messages after this one.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <Button variant="quiet" onClick={dismissConfirmation}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmRevert}>
              Revert
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Popup>
      </AlertDialog.Root>
    </>
  );
}
