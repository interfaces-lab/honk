import { Link } from "@tanstack/react-router";
import { IconChevronLeftMedium } from "central-icons";

import { SidebarItem } from "@honk/multikit/sidebar";
import { SETTINGS_SECTIONS } from "~/components/settings/settings-sections";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";

export function SettingsNavRail(props: { onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 select-none flex-col">
      <div className={cn("shrink-0", isElectron && "no-drag")}>
        <div className="flex flex-col gap-1 px-2 pt-2 pb-1.5">
          <SidebarItem
            type="button"
            onClick={props.onBack}
            className="text-honk-fg-secondary hover:text-honk-fg-primary"
            aria-label="Back to chat"
          >
            <IconChevronLeftMedium className="size-4 shrink-0 opacity-60" />
            <span className="min-w-0 truncate text-left">Back</span>
          </SidebarItem>
        </div>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-px px-2 pb-1.5" aria-label="Settings">
        {SETTINGS_SECTIONS.map((item) => {
          const Icon = item.icon;
          return (
            <SidebarItem
              key={item.to}
              render={
                <Link
                  to={item.to}
                  activeProps={{
                    className: "text-foreground",
                    "data-selected": "true",
                    "aria-current": "page",
                  }}
                  inactiveProps={{
                    className: "text-muted-foreground hover:text-foreground",
                  }}
                />
              }
            >
              <Icon className="size-4 shrink-0 opacity-60" />
              {item.label}
            </SidebarItem>
          );
        })}
      </nav>
    </div>
  );
}
