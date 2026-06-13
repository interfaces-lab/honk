import type { EditorId } from "@honk/contracts";
import type { WorkspaceEditorPlacement } from "~/stores/workspace-editor-store";
import {
  IconBarsThree,
  IconChevronLeftMedium,
  IconChevronRightMedium,
  IconFiles,
} from "central-icons";

import { shortcutLabelForCommand } from "~/keybindings";
import { useServerKeybindings } from "~/rpc/server-state";
import { WorkbenchTextButton } from "@honk/honkkit/workbench-button";
import { ProjectEditorBreadcrumbs } from "./project-editor-breadcrumbs";
import { ProjectEditorOverflowMenu } from "./project-editor-overflow-menu";
import { ModeButton, NavButton } from "./project-files-panel-buttons";

export function ProjectEditorToolbar(props: {
  workspaceKey: string | null;
  cwd: string | null;
  relativePath: string | null;
  availableEditors: readonly EditorId[];
  fileRailOpen: boolean;
  dirty: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  placement: WorkspaceEditorPlacement;
  onToggleFileTree: () => void;
  onOpenFile: () => void;
  onBack: () => void;
  onForward: () => void;
  onSave: () => void;
  onClose: () => void;
  onRevealInFileTree: () => void;
  onOpenExternalEditor: () => void;
}) {
  const keybindings = useServerKeybindings();
  const saveShortcut = shortcutLabelForCommand(keybindings, "editor.saveFile", {
    context: { editorFocus: true, terminalFocus: false, terminalOpen: false },
  });
  const saveTitle = saveShortcut ? `Save (${saveShortcut})` : "Save";

  return (
    <div className="honk-workbench-panel-title-row gap-(--honk-workbench-chrome-action-gap)">
      <ModeButton
        active={props.fileRailOpen}
        chrome="panel"
        label={props.fileRailOpen ? "Hide file tree" : "Show file tree"}
        onClick={props.onToggleFileTree}
      >
        <IconBarsThree className="size-[15px]" aria-hidden />
      </ModeButton>
      <ModeButton chrome="panel" label="Open file" onClick={props.onOpenFile}>
        <IconFiles className="size-4" aria-hidden />
      </ModeButton>
      <NavButton disabled={!props.canGoBack} chrome="panel" label="Back" onClick={props.onBack}>
        <IconChevronLeftMedium className="size-4" aria-hidden />
      </NavButton>
      <NavButton
        chrome="panel"
        disabled={!props.canGoForward}
        label="Forward"
        onClick={props.onForward}
      >
        <IconChevronRightMedium className="size-4" aria-hidden />
      </NavButton>
      <div className="min-w-0 flex-1">
        <ProjectEditorBreadcrumbs relativePath={props.relativePath} />
      </div>
      <WorkbenchTextButton
        title={saveTitle}
        disabled={!props.dirty}
        onClick={props.onSave}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-honk-control px-2 text-detail text-muted-foreground hover:bg-honk-hover hover:text-foreground disabled:opacity-45"
      >
        <span
          className={
            props.dirty
              ? "size-1.5 rounded-full bg-primary"
              : "size-1.5 rounded-full bg-muted-foreground/30"
          }
          aria-hidden
        />
        Save
      </WorkbenchTextButton>
      <ProjectEditorOverflowMenu
        workspaceKey={props.workspaceKey}
        cwd={props.cwd}
        relativePath={props.relativePath}
        availableEditors={props.availableEditors}
        dirty={props.dirty}
        placement={props.placement}
        onSave={props.onSave}
        onClose={props.onClose}
        onRevealInFileTree={props.onRevealInFileTree}
        onOpenExternalEditor={props.onOpenExternalEditor}
      />
    </div>
  );
}
