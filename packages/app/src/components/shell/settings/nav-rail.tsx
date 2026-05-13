import { Link } from "@tanstack/react-router";
import {
  IconArchive,
  IconArrowRotateCounterClockwise,
  IconChainLink1,
  IconCode,
  IconColorSwatch,
  IconRobot,
  IconSettingsGear2,
} from "central-icons";
import type { ComponentType } from "react";

import { Button } from "@multi/ui/button";
import { cn } from "~/lib/utils";
import { useSettingsRestoreState } from "../../settings/settings-restore-context";

const items: {
  to:
    | "/settings/general"
    | "/settings/appearance"
    | "/settings/agents"
    | "/settings/models"
    | "/settings/connections"
    | "/settings/archived";
  label: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { to: "/settings/general", label: "General", icon: IconSettingsGear2 },
  { to: "/settings/appearance", label: "Appearance", icon: IconColorSwatch },
  { to: "/settings/agents", label: "Agents", icon: IconRobot },
  { to: "/settings/models", label: "Models", icon: IconCode },
  { to: "/settings/connections", label: "Connections", icon: IconChainLink1 },
  { to: "/settings/archived", label: "Archived", icon: IconArchive },
];

export function SettingsNavRail() {
  const { changedSettingLabels, restoreDefaults } = useSettingsRestoreState();

  return (
    <div className="flex min-h-0 flex-1 select-none flex-col gap-1 px-2.5 pt-1.5 pb-2">
      <nav className="flex min-h-0 flex-1 flex-col gap-px" aria-label="Settings">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              activeProps={{
                className: cn(
                  "font-multi flex min-h-[26px] min-w-0 w-full select-none items-center justify-start gap-2 rounded-multi-control border border-transparent px-1.5 py-1.5 text-body transition-colors",
                  "border-multi-border/90 bg-multi-active text-foreground",
                ),
                "aria-current": "page",
              }}
              inactiveProps={{
                className: cn(
                  "font-multi flex min-h-[26px] min-w-0 w-full select-none items-center justify-start gap-2 rounded-multi-control border border-transparent px-1.5 py-1.5 text-body transition-colors",
                  "text-muted-foreground hover:bg-multi-hover hover:text-foreground",
                ),
              }}
            >
              <Icon className="size-3.5 shrink-0 opacity-60" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="shrink-0 border-t border-multi-border/40 pt-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full select-none"
          disabled={changedSettingLabels.length === 0}
          onClick={() => void restoreDefaults()}
        >
          <IconArrowRotateCounterClockwise className="size-3.5" />
          Restore defaults
        </Button>
      </div>
    </div>
  );
}
