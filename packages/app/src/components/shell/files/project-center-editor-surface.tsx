import type { EditorId, EnvironmentId } from "@honk/contracts";
import { Button } from "@honk/honkkit/button";
import { IconCrossSmall } from "central-icons";
import { useRef, useState } from "react";

import { shellPanelsActions } from "~/stores/shell-panels-store";
import { workbenchTabPersistenceActions } from "~/stores/workbench-tab-store";
import {
  useWorkspaceEditorFileState,
  workspaceEditorActions,
} from "~/stores/workspace-editor-store";
import { markProjectModelClosed } from "~/lib/monaco/project-models";
import { openProjectFilePath } from "./project-file-tree";
import {
  ProjectFileEditorShell,
  type ProjectFileEditorShellHandle,
} from "./project-file-editor-shell";
import { ProjectEditorToolbar } from "./project-editor-toolbar";

export function ProjectCenterEditorSurface(props: {
  cwd: string | null;
  workspaceKey: string | null;
  environmentId: EnvironmentId | null;
  availableEditors: readonly EditorId[];
}) {
  const [dirtyByPath, setDirtyByPath] = useState<Record<string, boolean>>({});
  const editorShellRef = useRef<ProjectFileEditorShellHandle | null>(null);
  const editorState = useWorkspaceEditorFileState(props.workspaceKey);
  const selectedPath = editorState.activePath;
  // Only one editor surface renders at a time; in right-panel placement the
  // files panel owns the editor and this surface must stay empty.
  if (!selectedPath || editorState.placement !== "center") return null;

  const selectedPathDirty = dirtyByPath[selectedPath] ?? false;
  const returnToSidePanel = () => {
    workspaceEditorActions.setEditorPlacement(props.workspaceKey, "right-panel");
  };
  const navigateBreadcrumbPath = (target: { kind: "directory" | "file"; path: string }) => {
    if (target.kind === "file") {
      workbenchTabPersistenceActions.createFile(props.workspaceKey, target.path);
    } else {
      workbenchTabPersistenceActions.createFile(props.workspaceKey, selectedPath);
    }
    workspaceEditorActions.setEditorPlacement(props.workspaceKey, "right-panel");
    shellPanelsActions.setSecondaryRailOpen(props.workspaceKey, "files", true);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-(--honk-workbench-editor-surface-background)">
      <div className="flex h-9 shrink-0 items-center justify-end border-b border-honk-border/30 px-2">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title="Back to chat"
          aria-label="Back to chat"
          onClick={returnToSidePanel}
        >
          <IconCrossSmall className="size-4" aria-hidden />
        </Button>
      </div>
      <ProjectEditorToolbar
        workspaceKey={props.workspaceKey}
        cwd={props.cwd}
        relativePath={selectedPath}
        availableEditors={props.availableEditors}
        fileRailOpen={false}
        dirty={selectedPathDirty}
        canGoBack={editorState.canGoBack}
        canGoForward={editorState.canGoForward}
        placement={editorState.placement}
        onToggleFileTree={() => {
          workbenchTabPersistenceActions.createFile(props.workspaceKey, selectedPath);
          shellPanelsActions.setSecondaryRailOpen(props.workspaceKey, "files", true);
        }}
        onOpenFile={() => {
          workbenchTabPersistenceActions.createFile(props.workspaceKey, selectedPath);
        }}
        onBack={() => workspaceEditorActions.navigateFileHistory(props.workspaceKey, -1)}
        onForward={() => workspaceEditorActions.navigateFileHistory(props.workspaceKey, 1)}
        onSave={() => editorShellRef.current?.save()}
        onClose={() => {
          if (props.cwd && props.environmentId) {
            markProjectModelClosed({
              environmentId: props.environmentId,
              cwd: props.cwd,
              relativePath: selectedPath,
            });
          }
          workspaceEditorActions.closeEditor(props.workspaceKey);
        }}
        onRevealInFileTree={() => {
          workbenchTabPersistenceActions.createFile(props.workspaceKey, selectedPath);
          shellPanelsActions.setSecondaryRailOpen(props.workspaceKey, "files", true);
        }}
        onOpenExternalEditor={() => {
          openProjectFilePath({
            relativePath: selectedPath,
            cwd: props.cwd,
            availableEditors: props.availableEditors,
          });
        }}
        onBreadcrumbNavigate={navigateBreadcrumbPath}
      />
      <ProjectFileEditorShell
        ref={editorShellRef}
        cwd={props.cwd}
        environmentId={props.environmentId}
        relativePath={selectedPath}
        onDirtyChange={(dirty) => {
          setDirtyByPath((current) => ({ ...current, [selectedPath]: dirty }));
        }}
        onAddSelectionToChat={returnToSidePanel}
      />
    </div>
  );
}
