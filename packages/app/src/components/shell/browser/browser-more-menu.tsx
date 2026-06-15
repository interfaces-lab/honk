import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@honk/honkkit/menu";
import { workbenchIconButtonVariants } from "@honk/honkkit/workbench-button";
import { IconDotGrid1x3Horizontal } from "central-icons";

export function BrowserMoreMenu(props: {
  hasPage: boolean;
  onClearBrowsingHistory: () => void;
  onClearCache: () => void;
  onClearCookies: () => void;
  onCopyUrl: () => void;
  onHardReload: () => void;
  onTakeScreenshot: () => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        type="button"
        className={workbenchIconButtonVariants({ chrome: "panel" })}
        aria-label="Browser actions"
        title="Browser actions"
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
        <MenuItem disabled={!props.hasPage} onClick={props.onTakeScreenshot} variant="workbench">
          Take Screenshot
        </MenuItem>
        <MenuSeparator className="my-1" variant="workbench" />
        <MenuItem disabled={!props.hasPage} onClick={props.onHardReload} variant="workbench">
          Hard Reload
        </MenuItem>
        <MenuItem disabled={!props.hasPage} onClick={props.onCopyUrl} variant="workbench">
          Copy Current URL
        </MenuItem>
        <MenuSeparator className="my-1" variant="workbench" />
        <MenuItem
          disabled={!props.hasPage}
          onClick={props.onClearBrowsingHistory}
          variant="workbench"
        >
          Clear Browsing History
        </MenuItem>
        <MenuItem disabled={!props.hasPage} onClick={props.onClearCookies} variant="workbench">
          Clear Cookies
        </MenuItem>
        <MenuItem disabled={!props.hasPage} onClick={props.onClearCache} variant="workbench">
          Clear Cache
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
