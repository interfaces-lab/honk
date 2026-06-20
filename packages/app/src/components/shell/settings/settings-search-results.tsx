import {
  IconArchive1,
  IconBuildingBlocks,
  IconCollaborationPointerRight,
  IconColorSwatch,
  IconSettingsGear2,
} from "central-icons";

import { SidebarItem } from "@honk/honkkit/sidebar";
import type { SettingsPreferenceEntry } from "~/components/settings/settings-preference-index";

function SettingsSearchResultIcon(props: { section: SettingsPreferenceEntry["section"] }) {
  switch (props.section) {
    case "appearance":
      return <IconColorSwatch className="size-4.5" />;
    case "agents":
      return <IconCollaborationPointerRight className="size-4.5" />;
    case "skills":
      return <IconBuildingBlocks className="size-4.5" />;
    case "archived":
      return <IconArchive1 className="size-4.5" />;
    case "general":
      return <IconSettingsGear2 className="size-4.5" />;
  }
}

export function SettingsSearchResults(props: {
  results: ReadonlyArray<SettingsPreferenceEntry>;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (entry: SettingsPreferenceEntry) => void;
}) {
  if (props.results.length === 0) {
    return <div className="px-3 py-3 text-detail text-honk-fg-tertiary">No matching settings.</div>;
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1.5 py-1.5"
      role="listbox"
    >
      {props.results.map((entry, index) => {
        const active = index === props.activeIndex;
        return (
          <SidebarItem
            key={entry.id}
            type="button"
            role="option"
            aria-selected={active}
            selected={active}
            className="h-auto min-h-11 items-center gap-2 px-2 py-1.5"
            onMouseEnter={() => props.onActiveIndexChange(index)}
            onClick={() => props.onSelect(entry)}
          >
            <span className="flex size-7 shrink-0 items-center justify-center text-honk-icon-secondary">
              <SettingsSearchResultIcon section={entry.section} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-body text-honk-fg-primary">{entry.title}</span>
              <span className="truncate text-detail text-honk-fg-tertiary">
                {entry.panelLabel}
                {entry.sectionTitle !== entry.panelLabel ? ` / ${entry.sectionTitle}` : ""}
              </span>
            </span>
          </SidebarItem>
        );
      })}
    </div>
  );
}
