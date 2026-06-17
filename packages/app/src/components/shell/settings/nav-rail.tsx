import { Link, useSearch } from "@tanstack/react-router";
import { IconChevronLeftMedium, IconMagnifyingGlass } from "central-icons";
import { useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";

import { InputGroup, InputGroupAddon, InputGroupInput } from "@honk/honkkit/input-group";
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
  const [activeResultIndex, setActiveResultIndex] = useState(0);

  const supportsAppIconSwitching =
    typeof window !== "undefined" &&
    window.desktopBridge !== undefined &&
    isMacPlatform(navigator.platform);

  const searchContext = useMemo(
    () => ({
      supportsAppIconSwitching,
      agentModeSupportsThinkingLevel: agentModeSupportsThinkingLevelSelection(agentMode),
    }),
    [agentMode, supportsAppIconSwitching],
  );

  const searchResults = useMemo(
    () =>
      filterSettingsPreferences({
        query: searchQuery,
        context: searchContext,
      }),
    [searchContext, searchQuery],
  );

  const isSearching = searchQuery.trim().length > 0;

  const selectResult = (entry: SettingsPreferenceEntry) => {
    focusPreference(entry.id);
  };

  const onSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
    setActiveResultIndex(0);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isSearching) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSearchQuery("");
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveResultIndex((current) => Math.min(current + 1, searchResults.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveResultIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const entry = searchResults[activeResultIndex];
      if (entry) {
        selectResult(entry);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setSearchQuery("");
    }
  };

  const searchInput = (
    <InputGroup
      size="default"
      className={cn(
        "h-6 rounded-honk-control bg-honk-bg-tertiary",
        isSearching
          ? "rounded-none border-0 border-b border-honk-stroke-quaternary bg-transparent has-focus-visible:ring-0"
          : "border-honk-stroke-tertiary",
      )}
    >
      <InputGroupAddon className="px-2">
        <IconMagnifyingGlass aria-hidden />
      </InputGroupAddon>
      <InputGroupInput
        value={searchQuery}
        onChange={onSearchChange}
        onKeyDown={onSearchKeyDown}
        type="search"
        placeholder="Search settings"
        aria-label="Search settings"
        spellCheck={false}
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore
        className="px-0 pe-2 text-body placeholder:text-honk-fg-tertiary"
      />
    </InputGroup>
  );

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
          {!isSearching ? <div className="px-0.5">{searchInput}</div> : null}
        </div>
      </div>
      {isSearching ? (
        <div className="mx-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-honk-stroke-tertiary bg-honk-bg-secondary shadow-sm">
          {searchInput}
          <SettingsSearchResults
            results={searchResults}
            activeIndex={activeResultIndex}
            onActiveIndexChange={setActiveResultIndex}
            onSelect={selectResult}
          />
        </div>
      ) : (
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
      )}
    </div>
  );
}
