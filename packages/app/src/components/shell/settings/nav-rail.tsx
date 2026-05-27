import { Link } from "@tanstack/react-router";
import {
  IconArchive1,
  IconChevronLeftMedium,
  IconCode,
  IconCollaborationPointerRight,
  IconColorSwatch,
  IconSettingsGear2,
} from "central-icons";
import type { ComponentType } from "react";

import { SidebarItem } from "~/components/shell/shared/sidebar-button";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";

const items: {
  to:
    | "/settings/general"
    | "/settings/appearance"
    | "/settings/agents"
    | "/settings/models"
    | "/settings/archived";
  label: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { to: "/settings/general", label: "General", icon: IconSettingsGear2 },
  { to: "/settings/appearance", label: "Appearance", icon: IconColorSwatch },
  { to: "/settings/agents", label: "Agents", icon: IconCollaborationPointerRight },
  { to: "/settings/models", label: "Models", icon: IconCode },
  { to: "/settings/archived", label: "Archived", icon: IconArchive1 },
];

export function SettingsNavRail(props: { onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 select-none flex-col">
      <div className={cn("shrink-0", isElectron && "no-drag")}>
        <div className="flex flex-col gap-1 px-2 pt-2 pb-1.5">
          <SidebarItem
            type="button"
            onClick={props.onBack}
            className="text-multi-fg-secondary hover:text-multi-fg-primary"
            aria-label="Back to chat"
          >
            <IconChevronLeftMedium className="size-4 shrink-0 opacity-60" />
            <span className="min-w-0 truncate text-left">Back</span>
          </SidebarItem>
        </div>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-px px-2 pb-1.5" aria-label="Settings">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <SidebarItem
              key={item.to}
              render={
                <Link
                  to={item.to}
                  activeProps={{
                    className: "bg-multi-bg-quaternary text-foreground",
                    "aria-current": "page",
                  }}
                  inactiveProps={{
                    className: "text-muted-foreground hover:bg-multi-bg-quaternary hover:text-foreground",
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
