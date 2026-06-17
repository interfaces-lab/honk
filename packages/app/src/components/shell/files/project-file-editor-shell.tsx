import type { EnvironmentId, ProjectReadFileResult } from "@honk/contracts";
import { Button } from "@honk/honkkit/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as monaco from "monaco-editor";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";

import { resolveShortcutCommand } from "~/keybindings";
import { readEnvironmentGitApi } from "~/lib/environment-git-api";
import {
  invalidateProjectFile,
  projectReadFileQueryOptions,
  writeProjectFile,
} from "~/lib/project-react-query";
import { refreshGitStatus } from "~/lib/git-status-state";
import {
  resetProjectModel,
  type ProjectModelKey,
} from "~/lib/monaco/project-models";
import { formatProjectErrorDescription } from "~/lib/project-error-description";
import { useServerKeybindings } from "~/rpc/server-state";
import { useEditorWordWrap } from "~/stores/workspace-editor-store";
import { useComposerHandleContext } from "../../chat/composer/context/handle-context";
import {
  ProjectEditorSelectionWidget,
  type EditorSelectionToChatPayload,
} from "./project-editor-selection-widget";
import {
  ProjectMonacoEditor,
  type ProjectMonacoModelEntry,
} from "./project-monaco-editor";
import { SourcePreview } from "./source-preview";

function isProjectWriteConflictError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "ProjectWriteConflictError"
  );
}

function isBinaryReadError(error: unknown): boolean {
  return formatProjectErrorDescription(error, "").includes(
    "Binary file previews are not supported",
  );
}

function sameProjectModelKey(left: ProjectModelKey, right: ProjectModelKey): boolean {
  return (
    left.environmentId === right.environmentId &&
    left.cwd === right.cwd &&
    left.relativePath === right.relativePath
  );
}

function UnableToReadFile(props: { error: unknown }) {
  const errorDescription = formatProjectErrorDescription(
    props.error,
    "The file could not be read.",
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-4 py-8 text-center">
      <div className="text-body font-medium text-destructive/85">Unable to preview file</div>
      <div className="max-w-72 whitespace-pre-wrap text-detail text-muted-foreground/55">
        {errorDescription}
      </div>
    </div>
  );
}

export type ProjectFileEditorShellHandle = {
  save: () => void;
};

export const ProjectFileEditorShell = forwardRef<
  ProjectFileEditorShellHandle,
  {
    cwd: string | null;
    environmentId: EnvironmentId | null;
    relativePath: string;
    onDirtyChange: (dirty: boolean) => void;
    onAddSelectionToChat?: () => void;
  }
>(function ProjectFileEditorShell(props, ref) {
  const canReadFile = Boolean(props.cwd && props.environmentId && props.relativePath);
  const queryClient = useQueryClient();
  const keybindings = useServerKeybindings();
  const composerHandle = useComposerHandleContext();
  const wordWrap = useEditorWordWrap();
  const modelEntryRef = useRef<ProjectMonacoModelEntry | null>(null);
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [conflict, setConflict] = useState(false);
  const [savingKey, setSavingKey] = useState<ProjectModelKey | null>(null);
  const fileQuery = useQuery(
    projectReadFileQueryOptions({
      cwd: props.cwd,
      environmentId: props.environmentId,
      relativePath: props.relativePath,
      enabled: canReadFile,
    }),
  );
  const editableFileData = fileQuery.data?.truncated === false ? fileQuery.data : null;
  const currentProjectKey =
    props.cwd && props.environmentId
      ? { environmentId: props.environmentId, cwd: props.cwd, relativePath: props.relativePath }
      : null;
  const saving =
    currentProjectKey !== null &&
    savingKey !== null &&
    sameProjectModelKey(savingKey, currentProjectKey);

  useEffect(() => {
    setConflict(false);
  }, [props.cwd, props.environmentId, props.relativePath]);

  const save = useCallback(
    async (options?: { overwrite?: boolean }) => {
      const modelEntry = modelEntryRef.current;
      const key =
        props.cwd && props.environmentId
          ? { environmentId: props.environmentId, cwd: props.cwd, relativePath: props.relativePath }
          : null;
      if (
        !key ||
        !editableFileData ||
        !modelEntry ||
        !sameProjectModelKey(modelEntry.key, key) ||
        saving
      ) {
        return;
      }

      const { cwd, environmentId } = key;
      const entry = modelEntry.entry;
      const contents = entry.model.getValue();
      setSavingKey(key);
      try {
        const result = await writeProjectFile({
          environmentId,
          file: {
            cwd,
            relativePath: props.relativePath,
            contents,
            ...(options?.overwrite
              ? {}
              : {
                  expectedMtimeMs: entry.lastReadMtimeMs ?? undefined,
                  expectedSizeBytes: entry.lastReadSizeBytes,
                }),
          },
        });
        entry.markSaved(contents, result.mtimeMs, result.sizeBytes);
        props.onDirtyChange(entry.dirty);
        const currentEntry = modelEntryRef.current;
        if (currentEntry && sameProjectModelKey(currentEntry.key, key)) {
          setConflict(false);
        }
        await invalidateProjectFile(queryClient, {
          environmentId,
          cwd,
          relativePath: props.relativePath,
        });
        const gitApi = readEnvironmentGitApi(environmentId);
        if (gitApi) {
          void refreshGitStatus({ environmentId, cwd }, gitApi, {
            force: true,
            scope: "local",
          }).catch(() => undefined);
        }
      } catch (error) {
        if (isProjectWriteConflictError(error)) {
          const currentEntry = modelEntryRef.current;
          if (currentEntry && sameProjectModelKey(currentEntry.key, key)) {
            setConflict(true);
          }
          return;
        }
        toast.error(formatProjectErrorDescription(error, "Unable to save file."));
      } finally {
        setSavingKey((currentKey) =>
          currentKey && sameProjectModelKey(currentKey, key) ? null : currentKey,
        );
      }
    },
    [editableFileData, props, queryClient, saving],
  );

  const reload = useCallback(async () => {
    const result = await fileQuery.refetch();
    const data = result.data;
    const modelEntry = modelEntryRef.current;
    const key =
      props.cwd && props.environmentId
        ? { environmentId: props.environmentId, cwd: props.cwd, relativePath: props.relativePath }
        : null;
    if (!data || !key || !modelEntry || !sameProjectModelKey(modelEntry.key, key)) return;
    resetProjectModel(modelEntry.entry, data.contents, data.mtimeMs, data.sizeBytes);
    props.onDirtyChange(modelEntry.entry.dirty);
    setConflict(false);
  }, [fileQuery, props]);

  useImperativeHandle(ref, () => ({ save: () => void save() }), [save]);

  // Direct imperative handoff (the command-palette idiom): the chat center
  // stays mounted while the editor is visible, so the composer handle is live.
  const addSelectionToChat = (payload: EditorSelectionToChatPayload) => {
    const handle = composerHandle?.current;
    if (!handle) return;
    handle.insertMention({
      path: payload.path,
      label: payload.label,
      lineStart: payload.lineStart,
      lineEnd: payload.lineEnd,
    });
    handle.focusAtEnd();
    props.onAddSelectionToChat?.();
  };

  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    const command = resolveShortcutCommand(event, keybindings, {
      context: { editorFocus: true, terminalFocus: false, terminalOpen: false },
    });
    if (command === "editor.addSelectionToChat") {
      const selection = editor?.getSelection();
      if (!selection || selection.isEmpty()) return;
      event.preventDefault();
      event.stopPropagation();
      const model = editor?.getModel();
      if (!model) return;
      addSelectionToChat({
        path: props.relativePath,
        label: props.relativePath.split(/[\\/]/).at(-1) || props.relativePath,
        lineStart: selection.startLineNumber,
        lineEnd: selection.endLineNumber,
        text: model.getValueInRange(selection),
      });
      return;
    }
    if (command !== "editor.saveFile") return;
    event.preventDefault();
    event.stopPropagation();
    void save();
  };

  if (fileQuery.isError && props.cwd && props.environmentId && isBinaryReadError(fileQuery.error)) {
    return (
      <>
        <div className="shrink-0 border-b border-honk-border/30 px-3 py-1.5 text-detail text-muted-foreground/60">
          This file cannot be edited here. Showing a read-only preview.
        </div>
        <SourcePreview
          cwd={props.cwd}
          environmentId={props.environmentId}
          selectedPath={props.relativePath}
          wordWrap
        />
      </>
    );
  }

  if (fileQuery.isError || !props.cwd || !props.environmentId) {
    return <UnableToReadFile error={fileQuery.error} />;
  }

  if (fileQuery.data?.truncated === true) {
    return (
      <>
        <div className="shrink-0 border-b border-honk-border/30 px-3 py-1.5 text-detail text-muted-foreground/60">
          This file is too large to edit here. Showing a read-only preview.
        </div>
        <SourcePreview
          cwd={props.cwd}
          environmentId={props.environmentId}
          selectedPath={props.relativePath}
          wordWrap
        />
      </>
    );
  }

  const fileData = fileQuery.data ?? null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" onKeyDownCapture={handleKeyDownCapture}>
      {conflict ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-detail text-warning-foreground">
          <span className="min-w-0 flex-1 truncate">File changed on disk</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void save({ overwrite: true })}
          >
            Overwrite
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void reload()}>
            Reload
          </Button>
        </div>
      ) : null}
      <ProjectMonacoEditor
        cwd={props.cwd}
        environmentId={props.environmentId}
        relativePath={props.relativePath}
        fileData={fileData}
        wordWrap={wordWrap}
        onDirtyChange={(dirty, modelEntry) => {
          modelEntryRef.current = modelEntry;
          props.onDirtyChange(dirty);
        }}
        onSaveRequest={(modelEntry) => {
          modelEntryRef.current = modelEntry;
          void save();
        }}
        onModelEntryChange={(modelEntry) => {
          modelEntryRef.current = modelEntry;
        }}
        onEditorReady={setEditor}
      />
      <ProjectEditorSelectionWidget
        editor={editor}
        relativePath={props.relativePath}
        keybindings={keybindings}
        onAddSelectionToChat={addSelectionToChat}
      />
    </div>
  );
});
