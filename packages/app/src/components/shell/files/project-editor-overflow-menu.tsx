import type { EditorId } from "@honk/contracts";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@honk/honkkit/menu";
import { workbenchIconButtonVariants } from "@honk/honkkit/workbench-button";
import { IconDotGrid1x3Horizontal } from "central-icons";

import {
  useEditorWordWrap,
  workspaceEditorActions,
  type WorkspaceEditorPlacement,
} from "~/stores/workspace-editor-store";

export function ProjectEditorOverflowMenu(props: {
  workspaceKey: string | null;
  cwd: string | null;
  relativePath: string | null;
  availableEditors: readonly EditorId[];
  dirty: boolean;
  placement: WorkspaceEditorPlacement;
  onSave: () => void;
  onClose: () => void;
  onRevealInFileTree: () => void;
  onOpenExternalEditor: () => void;
}) {
  const hasFile = props.relativePath !== null;
  const wordWrap = useEditorWordWrap();
  // Same primitive and configuration as the Changes panel's editor menu
  // (packages/app/src/components/shell/git/panel.tsx): the `workbench` variant
  // plus a bare MenuTrigger styled with workbenchIconButtonVariants, so both
  // dropdowns render identically.
  return (
    <Menu>
      <MenuTrigger
        type="button"
        className={workbenchIconButtonVariants({ chrome: "panel" })}
        aria-label="Editor actions"
        title="Editor actions"
        data-active={false}
        data-chrome="panel"
        data-slot="workbench-icon-button"
        data-tab-system={false}
      >
        <IconDotGrid1x3Horizontal className="size-4" aria-hidden />
      </MenuTrigger>
      <MenuPopup
        align="end"
        className="min-w-56"
        positionerClassName="z-(--z-index-workbench-menu)"
        sideOffset={4}
        variant="workbench"
      >
        <MenuItem disabled={!props.dirty} onClick={props.onSave} variant="workbench">
          Save
        </MenuItem>
        <MenuItem disabled={!hasFile} onClick={props.onClose} variant="workbench">
          Close Editor
        </MenuItem>
        <MenuSeparator className="my-1" variant="workbench" />
        <MenuCheckboxItem
          checked={wordWrap}
          onCheckedChange={(checked) => workspaceEditorActions.setWordWrap(checked)}
          variant="workbench-switch"
        >
          Word Wrap
        </MenuCheckboxItem>
        <MenuSeparator className="my-1" variant="workbench" />
        <MenuItem
          disabled={!hasFile}
          variant="workbench"
          onClick={() => {
            if (props.placement === "center") {
              workspaceEditorActions.setEditorPlacement(props.workspaceKey, "right-panel");
            } else if (props.relativePath !== null) {
              workspaceEditorActions.openFileInCenter(props.workspaceKey, props.relativePath);
            }
          }}
        >
          {props.placement === "center" ? "Open in Side Panel" : "Open in Center"}
        </MenuItem>
        <MenuSeparator className="my-1" variant="workbench" />
        <MenuItem disabled={!hasFile} onClick={props.onRevealInFileTree} variant="workbench">
          Reveal in File Tree
        </MenuItem>
        <MenuItem
          disabled={!hasFile || !props.cwd || props.availableEditors.length === 0}
          onClick={props.onOpenExternalEditor}
          variant="workbench"
        >
          Open in External Editor
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
