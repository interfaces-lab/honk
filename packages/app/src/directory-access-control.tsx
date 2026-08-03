import * as stylex from "@stylexjs/stylex";
import { basename } from "@honk/shared/paths";
import { Button, Icon, Pill, Popover, Tooltip } from "@honk/ui";
import { IconFolder1, IconFolderAddRight } from "@honk/ui/icons";
import { controlVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { DirectoryPicker } from "./directory-picker";

const DIRECTORY_CONTROLS_MAX_WIDTH = "430px";
const DIRECTORY_CHIP_MAX_WIDTH = "150px";

const styles = stylex.create({
  root: {
    minWidth: 0,
    maxWidth: DIRECTORY_CONTROLS_MAX_WIDTH,
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    overflowX: "auto",
    scrollbarWidth: "none",
  },
  label: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

function DirectoryAccessControl({
  cwd,
  attachedDirectories,
  recentDirectories,
  isOpen,
  isPending,
  canBrowse,
  onOpenChange,
  onAttach,
  onDetach,
  onBrowse,
}: {
  readonly cwd: string;
  readonly attachedDirectories: readonly string[];
  readonly recentDirectories: readonly string[];
  readonly isOpen: boolean;
  readonly isPending: boolean;
  readonly canBrowse: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAttach: (path: string) => void;
  readonly onDetach: (path: string) => void;
  readonly onBrowse: () => void;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.root)}>
      <Popover.Root
        open={isOpen}
        onOpenChange={(open) => {
          onOpenChange(open);
        }}
      >
        <Popover.Trigger
          render={
            <Button
              size="sm"
              variant="quiet"
              aria-label="Manage folder access"
              title={`${cwd} — manage folder access`}
              iconStart={<Icon icon={IconFolderAddRight} size="sm" tone="faint" />}
            >
              <span {...stylex.props(styles.label)}>{basename(cwd)}</span>
            </Button>
          }
        />
        <Popover.Popup side="top" align="start">
          <DirectoryPicker
            recentDirectories={recentDirectories}
            excludedDirectories={[cwd, ...attachedDirectories]}
            isPending={isPending}
            onSelect={onAttach}
            {...(canBrowse ? { onBrowse } : {})}
          />
        </Popover.Popup>
      </Popover.Root>

      {attachedDirectories.map((path) => (
        <Tooltip key={path} label={path}>
          <Pill
            size="md"
            tone="muted"
            hasRing
            icon={<Icon icon={IconFolder1} size="sm" tone="muted" />}
            onRemove={() => {
              onDetach(path);
            }}
            removeLabel={path}
            isRemoveDisabled={isPending}
            style={{ maxWidth: DIRECTORY_CHIP_MAX_WIDTH }}
          >
            {basename(path)}
          </Pill>
        </Tooltip>
      ))}
    </div>
  );
}

export { DirectoryAccessControl };
