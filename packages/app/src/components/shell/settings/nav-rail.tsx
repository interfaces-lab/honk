import { Link, useSearch } from "@tanstack/react-router";
import { IconChevronLeftMedium, IconMagnifyingGlass } from "central-icons";
import { useMemo, useState } from "react";

import {
  Autocomplete,
} from "@honk/honkkit/autocomplete";
import {
  CommandSearchEmpty,
  CommandSearchInput,
  CommandSearchList,
  CommandSearchPopup,
} from "@honk/honkkit/command";
import { SidebarItem } from "@honk/honkkit/sidebar";
import {
  filterSettingsPreferences,
  type SettingsPreferenceEntry,
} from "~/components/settings/settings-preference-index";
import { useSettingsSearch } from "~/components/settings/settings-search-context";
import { SETTINGS_SECTIONS } from "~/components/settings/settings-sections";
import { isElectron } from "~/env";
import { agentModeSupportsThinkingLevelSelection } from "~/lib/agent-mode-options";
import { cn, isMacPlatform } from "~/lib/utils";
import { useAgentRuntimeStore } from "~/stores/agent-runtime-store";
import { SettingsSearchResults } from "./settings-search-results";

export function SettingsNavRail(props: { onBack: () => void }) {
  const { focusPreference } = useSettingsSearch();
  const { section: activeSection } = useSearch({ from: "/settings" });
  const agentMode = useAgentRuntimeStore((state) => state.snapshot.preferences.agentMode);
  const [searchQuery, setSearchQuery] = useState("");

  const supportsAppIconSwitching =
    typeof window !== "undefined" &&
    window.desktopBridge !== undefined &&
    isMacPlatform(navigator.platform);

  const searchContext = {
    supportsAppIconSwitching,
    agentModeSupportsThinkingLevel: agentModeSupportsThinkingLevelSelection(agentMode),
  };

  const searchResults = useMemo(
    () => filterSettingsPreferences({ query: searchQuery, context: searchContext }),
    // searchContext is derived from runtime state above; recompute when its inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchQuery, supportsAppIconSwitching, agentMode],
  );

  const isSearching = searchQuery.trim().length > 0;

  const selectResult = (entry: SettingsPreferenceEntry) => {
    focusPreference(entry.id);
    setSearchQuery("");
  };

  return (
    <div className="flex min-h-0 flex-1 select-none flex-col">
      <div className={cn("shrink-0", isElectron && "no-drag")}>
        <div className="flex flex-col gap-2 px-2 pt-2 pb-1.5">
          <SidebarItem
            type="button"
            onClick={props.onBack}
            className="text-honk-fg-secondary hover:text-honk-fg-primary"
            aria-label="Back to chat"
          >
            <IconChevronLeftMedium className="size-4 shrink-0 opacity-60" />
            <span className="min-w-0 truncate text-left">Back</span>
          </SidebarItem>
          <Autocomplete
            open={isSearching}
            items={searchResults}
            filteredItems={searchResults}
            filter={null}
            mode="none"
            value={searchQuery}
            onValueChange={setSearchQuery}
            onOpenChange={(open) => {
              if (!open && searchQuery) {
                setSearchQuery("");
              }
            }}
            autoHighlight
          >
            <div className="px-0.5">
              <CommandSearchInput
                aria-label="Search settings"
                placeholder="Search settings"
                startAddon={<IconMagnifyingGlass aria-hidden />}
                autoComplete="off"
                spellCheck={false}
                data-lpignore="true"
                data-1p-ignore
              />
            </div>
            <CommandSearchPopup side="top" align="start" sideOffset={4} className="w-[min(var(--available-width),24rem)]">
              <CommandSearchList>
                <SettingsSearchResults results={searchResults} onSelect={selectResult} />
                {searchResults.length === 0 ? (
                  <CommandSearchEmpty>No matching settings.</CommandSearchEmpty>
                ) : null}
              </CommandSearchList>
            </CommandSearchPopup>
          </Autocomplete>
        </div>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-px px-2 pb-1.5" aria-label="Settings">
        {SETTINGS_SECTIONS.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeSection;
          return (
            <SidebarItem
              key={item.id}
              render={
                <Link
                  to={item.to}
                  search={item.search}
                  className={
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }
                  data-selected={active ? "true" : undefined}
                  aria-current={active ? "page" : undefined}
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
