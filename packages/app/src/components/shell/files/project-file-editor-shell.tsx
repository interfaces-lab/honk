import type { EnvironmentId, ProjectReadFileResult } from "@honk/contracts";
import { Button } from "@honk/honkkit/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as monaco from "monaco-editor";
import {
  forwardRef,
  useCallback,
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
import { resetProjectModel, type ProjectModelEntry } from "~/lib/monaco/project-models";
import { formatProjectErrorDescription } from "~/lib/project-error-description";
import { useServerKeybindings } from "~/rpc/server-state";
import { useEditorWordWrap } from "~/stores/workspace-editor-store";
import { useComposerHandleContext } from "../../chat/composer/context/handle-context";
import {
  ProjectEditorSelectionWidget,
  type EditorSelectionToChatPayload,
} from "./project-editor-selection-widget";
import { ProjectMonacoEditor } from "./project-monaco-editor";
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

function LoadingFileEditor() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="space-y-2 bg-(--honk-workbench-editor-surface-background) p-3">
        <div className="h-3 w-11/12 animate-pulse rounded bg-muted-foreground/10" />
        <div className="h-3 w-7/12 animate-pulse rounded bg-muted-foreground/10" />
        <div className="h-3 w-10/12 animate-pulse rounded bg-muted-foreground/10" />
      </div>
    </div>
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
  const modelEntryRef = useRef<ProjectModelEntry | null>(null);
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileQuery = useQuery(
    projectReadFileQueryOptions({
      cwd: props.cwd,
      environmentId: props.environmentId,
      relativePath: props.relativePath,
      enabled: canReadFile,
    }),
  );

  const save = useCallback(
    async (options?: { overwrite?: boolean }) => {
      const cwd = props.cwd;
      const environmentId = props.environmentId;
      const entry = modelEntryRef.current;
      if (!cwd || !environmentId || !entry || saving) return;

      const contents = entry.model.getValue();
      setSaving(true);
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
        setConflict(false);
        await invalidateProjectFile(queryClient, {
          environmentId,
          cwd,
          relativePath: props.relativePath,
        });
        const gitApi = readEnvironmentGitApi(environmentId);
        if (gitApi) {
          void refreshGitStatus({ environmentId, cwd }, gitApi, { force: true }).catch(
            () => undefined,
          );
        }
      } catch (error) {
        if (isProjectWriteConflictError(error)) {
          setConflict(true);
          return;
        }
        toast.error(formatProjectErrorDescription(error, "Unable to save file."));
      } finally {
        setSaving(false);
      }
    },
    [props, queryClient, saving],
  );

  const reload = useCallback(async () => {
    const result = await fileQuery.refetch();
    const data = result.data;
    const entry = modelEntryRef.current;
    if (!data || !entry) return;
    resetProjectModel(entry, data.contents, data.mtimeMs, data.sizeBytes);
    props.onDirtyChange(entry.dirty);
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

  if (canReadFile && fileQuery.isPending) {
    return <LoadingFileEditor />;
  }

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

  if (fileQuery.isError || !fileQuery.data || !props.cwd || !props.environmentId) {
    return <UnableToReadFile error={fileQuery.error} />;
  }

  if (fileQuery.data.truncated) {
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

  const fileData: ProjectReadFileResult = fileQuery.data;

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
        onDirtyChange={(dirty, entry) => {
          modelEntryRef.current = entry;
          props.onDirtyChange(dirty);
        }}
        onSaveRequest={(entry) => {
          modelEntryRef.current = entry;
          void save();
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
