import { ProviderInteractionMode, RuntimeMode } from "@multi/contracts";
import { memo, type ReactNode } from "react";
import { IconDotGrid1x3Horizontal, IconSquareChecklist } from "central-icons";
import { Button } from "@multi/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "@multi/ui/menu";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  activePlan: boolean;
  interactionMode: ProviderInteractionMode;
  planSidebarLabel: string;
  planSidebarOpen: boolean;
  runtimeMode: RuntimeMode;
  showInteractionModeToggle: boolean;
  /** Leading slot: Fast (~fastMode) only; Cursor composer overflow order Fast → Mode → Access. */
  traitsFastMenuContent?: ReactNode | null | undefined;
  /** Remaining reasoning / booleans excluding fast preset. Rendered after Access. */
  traitsRestMenuContent?: ReactNode | null | undefined;
  onToggleInteractionMode: () => void;
  onTogglePlanSidebar: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 select-none px-2.5 text-muted-foreground/70 hover:text-foreground/80"
            aria-label="More composer controls"
          />
        }
      >
        <IconDotGrid1x3Horizontal aria-hidden="true" className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="start" variant="workbench">
        {props.traitsFastMenuContent ? (
          <>
            {props.traitsFastMenuContent}
            <MenuDivider variant="workbench" />
          </>
        ) : null}
        {props.showInteractionModeToggle ? (
          <>
            <MenuGroup>
              <MenuGroupLabel variant="workbench">Mode</MenuGroupLabel>
              <MenuRadioGroup
                value={props.interactionMode}
                onValueChange={(value) => {
                  if (!value || value === props.interactionMode) return;
                  props.onToggleInteractionMode();
                }}
              >
                <MenuRadioItem variant="workbench" value="default">
                  Chat
                </MenuRadioItem>
                <MenuRadioItem variant="workbench" value="plan">
                  Plan
                </MenuRadioItem>
              </MenuRadioGroup>
            </MenuGroup>
            <MenuDivider variant="workbench" />
          </>
        ) : null}
        <MenuGroup>
          <MenuGroupLabel variant="workbench">Access</MenuGroupLabel>
          <MenuRadioGroup
            value={props.runtimeMode}
            onValueChange={(value) => {
              if (!value || value === props.runtimeMode) return;
              props.onRuntimeModeChange(value as RuntimeMode);
            }}
          >
            <MenuRadioItem variant="workbench" value="approval-required">
              Supervised
            </MenuRadioItem>
            <MenuRadioItem variant="workbench" value="auto-accept-edits">
              Auto-accept edits
            </MenuRadioItem>
            <MenuRadioItem variant="workbench" value="full-access">
              Full access
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
        {props.traitsRestMenuContent ? (
          <>
            <MenuDivider variant="workbench" />
            {props.traitsRestMenuContent}
          </>
        ) : null}
        {props.activePlan ? (
          <>
            <MenuDivider variant="workbench" />
            <MenuItem variant="workbench" onClick={props.onTogglePlanSidebar}>
              <IconSquareChecklist className="size-3.5 shrink-0" />
              {props.planSidebarOpen
                ? `Hide ${props.planSidebarLabel.toLowerCase()} sidebar`
                : `Show ${props.planSidebarLabel.toLowerCase()} sidebar`}
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});
