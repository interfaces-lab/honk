import { type ProjectEntry, type EnvironmentId, type ThreadId } from "@honk/contracts";
import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
} from "@honk/shared/search-ranking";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import {
  IconBubble2,
  IconBug,
  IconBubbleQuestion,
  IconRobot,
  IconSquareChecklist,
} from "central-icons";
import { useMemo, type ComponentProps } from "react";
import { useShallow } from "zustand/react/shallow";

import { Popover, PopoverPopup } from "@honk/honkkit/popover";
import { isDesktopRuntimeApiAvailable } from "~/lib/honk-runtime-api";
import { runtimeSkillsQueryOptions, type RuntimeSkillSummary } from "~/lib/runtime-skills";
import { selectSidebarThreadsAcrossEnvironments, useStore } from "~/stores/thread-store";
import { cn } from "~/lib/utils";

import {
  type ComposerSlashCommand,
  type ComposerTrigger,
  type ComposerTriggerKind,
} from "../prompt-triggers";
import { basenameOfPath } from "../../shared/vscode-entry-icons";
import { SkillIcon } from "../prompt-editor/chips";
import type { ComposerMenuPopoverAnchor } from "./anchor";
import { projectSearchEntriesQueryOptions } from "~/lib/project-react-query";
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@honk/honkkit/command";
import { VscodeEntryIcon } from "../../shared/vscode-entry-icon";
import { ComposerPathPreviewPanel } from "./path-preview";
import { buildPastThreadCandidates } from "./thread-items";

/**
 * Composer command menu (`/` slash commands and `@` mentions).
 *
 * Both menus render through `ComposerCommandMenuPositioned`. See AGENTS.md
 * "Composer command menu" for the full contract. In short:
 *
 * - Anchor: live DOM rect from `prompt-editor.tsx` trigger-origin span via
 *   `composerMenuPopoverAnchorFromElement` in `input.tsx`.
 * - Placement: `side="top"`, `positionMethod="fixed"`, dropdown collision
 *   (`shift`, `fallbackAxisSide: "none"`), no popover remount on anchor moves.
 * - Sizing: popup shell needs fixed width AND height caps (`w-*` + `max-w-*`,
 *   `max-h-[342px]`). Inner `CommandList` scrolls; do not rely on
 *   `min(20rem, var(--available-height))` alone during Base UI measurement.
 */
const PATH_QUERY_DEBOUNCE_MS = 120;
const COMPOSER_MENU_SIDE_OFFSET = 4;
/** Match Base UI dropdown menus: shift within viewport, never flip to a side axis. */
const COMPOSER_MENU_COLLISION_AVOIDANCE = {
  side: "shift",
  align: "shift",
  fallbackAxisSide: "none",
} as const;
const EMPTY_PROJECT_ENTRIES: ProjectEntry[] = [];
const EMPTY_RUNTIME_SKILLS: ReadonlyArray<RuntimeSkillSummary> = [];
/** Cursor parity: collapsed sections show 3 items above a "Show N more" row. */
const SLASH_MENU_COLLAPSED_SKILL_COUNT = 3;
const SLASH_MENU_SKILLS_SECTION_ID = "skills";
const MENTIONS_MENU_COLLAPSED_FILE_COUNT = 3;
const MENTIONS_MENU_FILES_SECTION_ID = "files";

export type ComposerCommandItem =
  | {
      id: string;
      type: "path";
      path: string;
      pathKind: ProjectEntry["kind"];
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "slash-command";
      command: ComposerSlashCommand;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "skill";
      name: string;
      description: string;
      /** Absolute path to the skill's SKILL.md (rides into the inserted token). */
      path: string;
    }
  | {
      id: string;
      type: "thread";
      threadId: ThreadId;
      title: string;
      description: string;
    }
  | {
      id: string;
      type: "expander";
      sectionId: string;
      count: number;
      /** Highlight hand-off target: the first item revealed by expanding. */
      firstRevealedItemId: string;
    };

type ComposerCommandGroup = {
  id: string;
  label: string | null;
  items: ComposerCommandItem[];
};
type ComposerCommandMenuKind = "slash" | "mentions";

function readComposerMenuCollisionPaddingTop(): number {
  if (typeof document === "undefined") {
    return 8;
  }
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--honk-composer-menu-collision-padding-top")
    .trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 8;
}

function composerMenuCollisionPadding() {
  const top = readComposerMenuCollisionPaddingTop();
  return { top, bottom: 8, left: 8, right: 8 } as const;
}

function scoreSlashCommandItem(
  item: Extract<ComposerCommandItem, { type: "slash-command" }>,
  query: string,
): number | null {
  const primaryValue = item.command.toLowerCase();
  const displayValue = item.label.toLowerCase();
  const description = item.description.toLowerCase();

  const scores = [
    scoreQueryMatch({
      value: primaryValue,
      query,
      exactBase: 0,
      prefixBase: 2,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 100,
      boundaryMarkers: ["-", "_", "/"],
    }),
    scoreQueryMatch({
      value: displayValue,
      query,
      exactBase: 10,
      prefixBase: 12,
      boundaryBase: 14,
      includesBase: 16,
    }),
    scoreQueryMatch({
      value: description,
      query,
      exactBase: 20,
      prefixBase: 22,
      boundaryBase: 24,
      includesBase: 26,
    }),
  ].filter((score): score is number => score !== null);

  return scores.length > 0 ? Math.min(...scores) : null;
}

function scoreSkillCommandItem(
  item: Extract<ComposerCommandItem, { type: "skill" }>,
  query: string,
): number | null {
  const scores = [
    scoreQueryMatch({
      value: item.name.toLowerCase(),
      query,
      exactBase: 0,
      prefixBase: 2,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 100,
      boundaryMarkers: ["-", "_", ":"],
    }),
    scoreQueryMatch({
      value: item.description.toLowerCase(),
      query,
      exactBase: 20,
      prefixBase: 22,
      boundaryBase: 24,
      includesBase: 26,
    }),
  ].filter((score): score is number => score !== null);

  return scores.length > 0 ? Math.min(...scores) : null;
}

function searchSlashMenuItems(
  modeItems: ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>,
  skillItems: ReadonlyArray<Extract<ComposerCommandItem, { type: "skill" }>>,
  query: string,
): ComposerCommandItem[] {
  const normalizedQuery = normalizeSearchQuery(query, { trimLeadingPattern: /^\/+/ });
  if (!normalizedQuery) {
    return [...modeItems, ...skillItems];
  }

  // Cursor parity: a mode whose command starts with the query is pinned above
  // every other match ("/deb" puts Debug mode first even among skill hits).
  const pinnedModeItems = modeItems.filter((item) =>
    item.command.toLowerCase().startsWith(normalizedQuery),
  );
  const pinnedModeIds = new Set(pinnedModeItems.map((item) => item.id));

  const ranked: Array<{
    item: ComposerCommandItem;
    score: number;
    tieBreaker: string;
  }> = [];

  for (const item of modeItems) {
    if (pinnedModeIds.has(item.id)) continue;
    const score = scoreSlashCommandItem(item, normalizedQuery);
    if (score === null) continue;
    insertRankedSearchResult(
      ranked,
      {
        item,
        score,
        tieBreaker: `0\u0000${item.command}`,
      },
      Number.POSITIVE_INFINITY,
    );
  }

  for (const item of skillItems) {
    const score = scoreSkillCommandItem(item, normalizedQuery);
    if (score === null) continue;
    insertRankedSearchResult(
      ranked,
      {
        item,
        score,
        tieBreaker: `1\u0000${item.name}`,
      },
      Number.POSITIVE_INFINITY,
    );
  }

  return [...pinnedModeItems, ...ranked.map((entry) => entry.item)];
}

function toPathCommandItems(entries: ReadonlyArray<ProjectEntry>): ComposerCommandItem[] {
  const seenPaths = new Set<string>();
  const uniqueEntries = entries.filter((entry) => {
    if (seenPaths.has(entry.path)) {
      return false;
    }
    seenPaths.add(entry.path);
    return true;
  });
  const basenameCounts = new Map<string, number>();
  for (const entry of uniqueEntries) {
    const basename = basenameOfPath(entry.path).toLowerCase();
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
  }
  return uniqueEntries.map((entry) => {
    const basename = basenameOfPath(entry.path);
    const parentPath = entry.parentPath ?? "";
    const description =
      (basenameCounts.get(basename.toLowerCase()) ?? 0) > 1 ? entry.path : parentPath;
    return {
      id: `path:${entry.kind}:${entry.path}`,
      type: "path" as const,
      path: entry.path,
      pathKind: entry.kind,
      label: basename,
      description,
    };
  });
}

/** Files before directories for the default (unsearched) `@` list. */
function filePathItemRank(item: ComposerCommandItem): number {
  return item.type === "path" && item.pathKind === "file" ? 0 : 1;
}

function resolveComposerMenuActiveItemId(input: {
  items: ReadonlyArray<{ id: string }>;
  highlightedItemId: string | null;
  currentSearchKey: string | null;
  highlightedSearchKey: string | null;
}): string | null {
  if (input.items.length === 0) {
    return null;
  }

  if (
    input.currentSearchKey === input.highlightedSearchKey &&
    input.highlightedItemId &&
    input.items.some((item) => item.id === input.highlightedItemId)
  ) {
    return input.highlightedItemId;
  }

  return input.items[0]?.id ?? null;
}

export function useComposerCommandMenu(input: {
  activeThreadId: ThreadId | null;
  allowModeSlashCommands?: boolean | undefined;
  composerTrigger: ComposerTrigger | null;
  environmentId: EnvironmentId;
  expandedSections: ReadonlySet<string>;
  gitCwd: string | null;
  highlightedItemId: string | null;
  highlightedSearchKey: string | null;
}) {
  const composerTriggerKind = input.composerTrigger?.kind ?? null;
  const pathTriggerQuery =
    input.composerTrigger?.kind === "path" ? input.composerTrigger.query : "";
  const slashTriggerQuery =
    input.composerTrigger?.kind === "slash-command" ? input.composerTrigger.query : "";
  const shouldSearchProjectEntries = composerTriggerKind === "path";
  const [debouncedPathQuery, pathQueryDebouncer] = useDebouncedValue(
    pathTriggerQuery,
    { wait: PATH_QUERY_DEBOUNCE_MS },
    (debouncerState) => ({ isPending: debouncerState.isPending }),
  );
  const effectivePathQuery = pathTriggerQuery.length > 0 ? debouncedPathQuery : "";
  const projectEntriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      environmentId: input.environmentId,
      cwd: input.gitCwd,
      query: effectivePathQuery,
      enabled: shouldSearchProjectEntries,
      allowEmptyQuery: true,
      limit: 80,
    }),
  );
  const projectEntries = projectEntriesQuery.data?.entries ?? EMPTY_PROJECT_ENTRIES;
  const isPathSearchPending =
    shouldSearchProjectEntries &&
    ((pathTriggerQuery.length > 0 && pathQueryDebouncer.state.isPending) ||
      projectEntriesQuery.isLoading ||
      projectEntriesQuery.isFetching);

  // Skills and past threads both resolve through the desktop runtime bridge;
  // pure-web builds expose neither, so both features degrade to absent.
  const runtimeApiAvailable = isDesktopRuntimeApiAvailable();
  const skillsQueryEnabled =
    composerTriggerKind === "slash-command" && input.allowModeSlashCommands !== false;
  const runtimeSkillsQuery = useQuery(
    runtimeSkillsQueryOptions({ cwd: input.gitCwd, enabled: skillsQueryEnabled }),
  );
  const runtimeSkills = runtimeSkillsQuery.data?.skills ?? EMPTY_RUNTIME_SKILLS;
  const sidebarThreads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));

  const composerMenuItems: ComposerCommandItem[] = (() => {
    if (!input.composerTrigger) return [];
    if (input.composerTrigger.kind === "path") {
      // Empty `@` shows a default file list (collapsed to 3 + "Show N more")
      // above Past Threads. The project index ranks directories first, but `@`
      // mentions target files, so the default view surfaces files first.
      const pathUnsearched = pathTriggerQuery.trim().length === 0;
      const baseFileItems = toPathCommandItems(projectEntries);
      const fileItems = pathUnsearched
        ? baseFileItems.toSorted((left, right) => filePathItemRank(left) - filePathItemRank(right))
        : baseFileItems;
      const filesExpanded = input.expandedSections.has(MENTIONS_MENU_FILES_SECTION_ID);
      const visibleFileItems =
        pathUnsearched && !filesExpanded
          ? fileItems.slice(0, MENTIONS_MENU_COLLAPSED_FILE_COUNT)
          : fileItems;
      const firstHiddenFileItem = fileItems[MENTIONS_MENU_COLLAPSED_FILE_COUNT];
      const fileExpanderItems: ComposerCommandItem[] =
        pathUnsearched && !filesExpanded && firstHiddenFileItem !== undefined
          ? [
              {
                id: `expander:${MENTIONS_MENU_FILES_SECTION_ID}`,
                type: "expander",
                sectionId: MENTIONS_MENU_FILES_SECTION_ID,
                count: fileItems.length - MENTIONS_MENU_COLLAPSED_FILE_COUNT,
                firstRevealedItemId: firstHiddenFileItem.id,
              },
            ]
          : [];
      // Threads join the list when the file search has settled (or the query
      // is empty) so the default highlight never locks onto a thread row that
      // file results are about to displace.
      const includeThreads = runtimeApiAvailable && (pathUnsearched || !isPathSearchPending);
      const threadItems: ComposerCommandItem[] = includeThreads
        ? buildPastThreadCandidates(sidebarThreads, {
            activeThreadId: input.activeThreadId,
            environmentId: input.environmentId,
            query: pathTriggerQuery,
          }).map((candidate) => ({
            id: `thread:${candidate.threadId}`,
            type: "thread" as const,
            threadId: candidate.threadId,
            title: candidate.title,
            description: candidate.description,
          }))
        : [];
      return [...visibleFileItems, ...fileExpanderItems, ...threadItems];
    }
    if (input.composerTrigger.kind !== "slash-command") {
      return [];
    }

    const builtInSlashCommandItems: Array<Extract<ComposerCommandItem, { type: "slash-command" }>> =
      [];
    if (input.allowModeSlashCommands !== false) {
      builtInSlashCommandItems.push(
        {
          id: "slash:ask",
          type: "slash-command",
          command: "ask",
          label: "/ask",
          description: "Ask questions without making changes",
        },
        {
          id: "slash:plan",
          type: "slash-command",
          command: "plan",
          label: "/plan",
          description: "Create a proposed plan",
        },
        {
          id: "slash:debug",
          type: "slash-command",
          command: "debug",
          label: "/debug",
          description: "Focus on diagnostics before making changes",
        },
      );
    }
    const skillItems: Array<Extract<ComposerCommandItem, { type: "skill" }>> =
      input.allowModeSlashCommands === false
        ? []
        : runtimeSkills.map((skill) => ({
            id: `skill:${skill.name}`,
            type: "skill" as const,
            name: skill.name,
            description: skill.description,
            path: skill.filePath,
          }));
    const query = input.composerTrigger.query.trim();
    if (query) {
      return searchSlashMenuItems(builtInSlashCommandItems, skillItems, query);
    }

    // Unsearched: Skills section (collapsed to 3 + "Show N more") above Modes.
    const skillsExpanded = input.expandedSections.has(SLASH_MENU_SKILLS_SECTION_ID);
    const visibleSkillItems = skillsExpanded
      ? skillItems
      : skillItems.slice(0, SLASH_MENU_COLLAPSED_SKILL_COUNT);
    const firstHiddenSkillItem = skillItems[SLASH_MENU_COLLAPSED_SKILL_COUNT];
    const expanderItems: ComposerCommandItem[] =
      !skillsExpanded && firstHiddenSkillItem !== undefined
        ? [
            {
              id: `expander:${SLASH_MENU_SKILLS_SECTION_ID}`,
              type: "expander",
              sectionId: SLASH_MENU_SKILLS_SECTION_ID,
              count: skillItems.length - SLASH_MENU_COLLAPSED_SKILL_COUNT,
              firstRevealedItemId: firstHiddenSkillItem.id,
            },
          ]
        : [];
    return [...visibleSkillItems, ...expanderItems, ...builtInSlashCommandItems];
  })();

  // Keep the slash menu open while the skills list is still loading so a
  // skill-only query does not flash the menu closed before results land.
  const slashSkillsPending = skillsQueryEnabled && runtimeSkillsQuery.isLoading;
  const slashQueryHasMatches =
    composerTriggerKind !== "slash-command" ||
    slashTriggerQuery.trim().length === 0 ||
    composerMenuItems.length > 0 ||
    slashSkillsPending;
  const composerMenuOpen =
    input.composerTrigger !== null &&
    (composerTriggerKind !== "slash-command" || slashQueryHasMatches);
  const composerMenuSearchKey = input.composerTrigger
    ? `${input.composerTrigger.kind}:${input.composerTrigger.query.trim().toLowerCase()}`
    : null;
  const activeComposerMenuItemId = resolveComposerMenuActiveItemId({
    items: composerMenuItems,
    highlightedItemId: input.highlightedItemId,
    currentSearchKey: composerMenuSearchKey,
    highlightedSearchKey: input.highlightedSearchKey,
  });
  const activeComposerMenuItem =
    composerMenuItems.find((item) => item.id === activeComposerMenuItemId) ?? null;

  const isComposerMenuLoading = isPathSearchPending;
  const composerMenuEmptyState =
    composerTriggerKind === "path" ? "No results found" : "No commands found";
  const composerMenuAriaLabel: "Slash commands" | "Mentions" =
    composerTriggerKind === "slash-command" ? "Slash commands" : "Mentions";
  const composerMenuKind: ComposerCommandMenuKind =
    composerTriggerKind === "slash-command" ? "slash" : "mentions";
  const composerMenuIsSearching =
    composerTriggerKind === "slash-command" && slashTriggerQuery.trim().length > 0;

  return {
    composerTriggerKind,
    composerMenuItems,
    composerMenuOpen,
    composerMenuSearchKey,
    activeComposerMenuItemId,
    activeComposerMenuItem,
    isComposerMenuLoading,
    composerMenuEmptyState,
    composerMenuAriaLabel,
    composerMenuKind,
    composerMenuIsSearching,
  };
}

function renderSlashCommandIcon(command: ComposerSlashCommand) {
  const className = "size-4 shrink-0 text-honk-fg-secondary";
  if (command === "ask") return <IconBubbleQuestion className={className} />;
  if (command === "plan") return <IconSquareChecklist className={className} />;
  if (command === "debug") return <IconBug className={className} />;
  return <IconRobot className={className} />;
}

function getSlashCommandTertiaryText(command: ComposerSlashCommand): string {
  if (command === "ask") return "Ask Mode";
  if (command === "plan") return "Plan Mode";
  if (command === "debug") return "Debug Mode";
  return "Build Mode";
}

function groupCommandItems(
  items: ComposerCommandItem[],
  triggerKind: ComposerTriggerKind | null,
  groupSlashCommandSections: boolean,
  isSearching: boolean,
): ComposerCommandGroup[] {
  if (triggerKind === "path") {
    const fileItems = items.filter((item) => item.type === "path" || item.type === "expander");
    const threadItems = items.filter((item) => item.type === "thread");
    const groups: ComposerCommandGroup[] = [];
    if (fileItems.length > 0) {
      groups.push({ id: "files", label: "Files & Folders", items: fileItems });
    }
    if (threadItems.length > 0) {
      groups.push({ id: "threads", label: "Past Threads", items: threadItems });
    }
    return groups;
  }
  if (triggerKind !== "slash-command" || !groupSlashCommandSections) {
    return [{ id: "default", label: null, items }];
  }
  if (isSearching) {
    return items.length > 0 ? [{ id: "results", label: "Results", items }] : [];
  }

  const skillSectionItems = items.filter(
    (item) => item.type === "skill" || item.type === "expander",
  );
  const modeItems = items.filter((item) => item.type === "slash-command");
  const groups: ComposerCommandGroup[] = [];
  if (skillSectionItems.length > 0) {
    groups.push({ id: "skills", label: "Skills", items: skillSectionItems });
  }
  if (modeItems.length > 0) {
    groups.push({ id: "modes", label: "Modes", items: modeItems });
  }
  return groups;
}

export function ComposerCommandMenu(props: {
  items: ComposerCommandItem[];
  resolvedTheme: "light" | "dark";
  isLoading: boolean;
  ariaLabel: "Slash commands" | "Mentions";
  menuKind: ComposerCommandMenuKind;
  triggerKind: ComposerTriggerKind | null;
  groupSlashCommandSections?: boolean;
  isSearching?: boolean;
  emptyStateText?: string;
  activeItemId: string | null;
  activePathPreview?: { path: string; pathKind: ProjectEntry["kind"] } | null;
  onHighlightedItemChange: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const groups = groupCommandItems(
    props.items,
    props.triggerKind,
    props.groupSlashCommandSections ?? true,
    props.isSearching ?? false,
  );
  const activePathPreview = props.activePathPreview ?? null;

  return (
    <Command
      aria-label={props.ariaLabel}
      autoHighlight={false}
      mode="none"
      onItemHighlighted={(highlightedValue) => {
        props.onHighlightedItemChange(
          typeof highlightedValue === "string" ? highlightedValue : null,
        );
      }}
    >
      <div
        className="relative w-full max-w-full min-w-0 overflow-hidden rounded-lg border border-honk-stroke-secondary bg-(--honk-composer-popup-surface-background) font-honk text-honk-chrome text-honk-fg-primary shadow-honk-xl backdrop-blur-[length:var(--honk-glass-blur-floating)] motion-reduce:animate-none motion-reduce:transition-none"
        data-menu-kind={props.menuKind}
        data-variant="surface"
      >
        {/* 340px = 342px popup shell cap minus the 1px top/bottom border. */}
        <CommandList className="max-h-[min(340px,var(--available-height))] overflow-x-hidden overflow-y-auto">
          {groups.map((group, groupIndex) => (
            <div key={group.id}>
              {groupIndex > 0 ? <CommandSeparator className="my-px" /> : null}
              <CommandGroup>
                {group.label ? (
                  <CommandGroupLabel className="px-1.5 py-0.5 text-detail font-medium text-honk-fg-tertiary opacity-60">
                    {group.label}
                  </CommandGroupLabel>
                ) : null}
                {group.items.map((item) => (
                  <ComposerCommandMenuItem
                    key={item.id}
                    item={item}
                    resolvedTheme={props.resolvedTheme}
                    isActive={props.activeItemId === item.id}
                    onHighlight={props.onHighlightedItemChange}
                    onSelect={props.onSelect}
                  />
                ))}
              </CommandGroup>
            </div>
          ))}
        </CommandList>
        {props.items.length === 0 ? (
          <div className="px-2.5 py-2">
            <p className="text-body text-honk-fg-tertiary">
              {props.isLoading
                ? "Searching project files..."
                : (props.emptyStateText ??
                  (props.triggerKind === "path"
                    ? "No matching files or folders."
                    : "No matching command."))}
            </p>
          </div>
        ) : null}
      </div>
      <ComposerPathPreviewPanel
        open={props.menuKind === "mentions" && activePathPreview !== null}
        path={activePathPreview?.path ?? null}
        pathKind={activePathPreview?.pathKind ?? null}
        resolvedTheme={props.resolvedTheme}
      />
    </Command>
  );
}

const ComposerCommandMenuItem = function ComposerCommandMenuItem(props: {
  item: ComposerCommandItem;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
  onHighlight: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const scrollActiveItemIntoView = (node: HTMLElement | null) => {
    if (!node || !props.isActive) return;
    node.scrollIntoView({ block: "nearest" });
  };

  if (props.item.type === "expander") {
    return (
      <CommandItem
        ref={props.isActive ? scrollActiveItemIntoView : undefined}
        value={props.item.id}
        data-composer-item-id={props.item.id}
        data-is-selected={props.isActive ? "" : undefined}
        data-menu-item-type={props.item.type}
        className="flex min-h-[22px] cursor-pointer items-center rounded-honk-control px-1.5 py-1 text-detail text-honk-fg-tertiary select-none hover:bg-honk-bg-quaternary data-highlighted:bg-honk-bg-quaternary data-[is-selected]:bg-honk-bg-quaternary"
        onMouseMove={() => {
          if (!props.isActive) props.onHighlight(props.item.id);
        }}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          props.onSelect(props.item);
        }}
      >
        Show {props.item.count} more
      </CommandItem>
    );
  }

  const itemIcon =
    props.item.type === "slash-command" ? (
      renderSlashCommandIcon(props.item.command)
    ) : props.item.type === "skill" ? (
      <SkillIcon className="size-4 shrink-0 text-honk-fg-secondary" />
    ) : props.item.type === "thread" ? (
      <IconBubble2 className="size-4 shrink-0 text-honk-fg-secondary" />
    ) : null;
  const tertiaryText =
    props.item.type === "slash-command" ? getSlashCommandTertiaryText(props.item.command) : null;
  const label =
    props.item.type === "skill"
      ? props.item.name
      : props.item.type === "thread"
        ? props.item.title
        : props.item.label;

  return (
    <CommandItem
      ref={props.isActive ? scrollActiveItemIntoView : undefined}
      value={props.item.id}
      data-composer-item-id={props.item.id}
      data-is-selected={props.isActive ? "" : undefined}
      data-menu-item-type={props.item.type}
      className="flex min-h-[22px] cursor-pointer items-center gap-1.5 rounded-honk-control px-1.5 py-1 text-body text-honk-fg-primary select-none hover:bg-honk-bg-quaternary data-highlighted:bg-honk-bg-quaternary data-[is-selected]:bg-honk-bg-quaternary"
      onMouseMove={() => {
        if (!props.isActive) props.onHighlight(props.item.id);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onSelect(props.item);
      }}
    >
      {props.item.type === "path" ? (
        <VscodeEntryIcon
          pathValue={props.item.path}
          kind={props.item.pathKind}
          theme={props.resolvedTheme}
        />
      ) : null}
      {itemIcon}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="min-w-0 shrink truncate text-body font-medium text-honk-fg-primary">
          {label}
        </span>
        <span className="min-w-0 flex-1 truncate text-detail text-honk-fg-tertiary">
          {props.item.description}
        </span>
      </span>
      {tertiaryText ? (
        <span className="flex-none whitespace-nowrap rounded-full border border-honk-stroke-secondary bg-honk-bg-tertiary/70 px-1.5 py-0 text-caption text-honk-fg-tertiary">
          {tertiaryText}
        </span>
      ) : null}
    </CommandItem>
  );
};

type ComposerCommandMenuPositionedProps = ComponentProps<typeof ComposerCommandMenu> & {
  open: boolean;
  anchor: ComposerMenuPopoverAnchor;
  anchorRevision: number;
};

export function ComposerCommandMenuPositioned(props: ComposerCommandMenuPositionedProps) {
  const { open, anchor, anchorRevision, menuKind, ...menuProps } = props;
  const menuOpen = open;
  const collisionPadding = open
    ? composerMenuCollisionPadding()
    : { top: 8, bottom: 8, left: 8, right: 8 };
  const collisionBoundary = typeof document === "undefined" ? undefined : document.documentElement;
  // The menu anchor is a virtual element (no DOM node), so Base UI's autoUpdate cannot
  // observe it. A new anchor identity per revision re-runs Floating UI positioning when
  // the trigger-origin span moves (Cursor-style MutationObserver → updateFloating). Do not
  // `key={anchorRevision}` the popup — remounting causes jitter (see AGENTS.md).
  const revisionedAnchor = useMemo<ComposerMenuPopoverAnchor>(
    () => ({ getBoundingClientRect: () => anchor.getBoundingClientRect() }),
    [anchor, anchorRevision],
  );

  return (
    <Popover open={menuOpen}>
      <PopoverPopup
        anchor={revisionedAnchor}
        align="start"
        collisionAvoidance={COMPOSER_MENU_COLLISION_AVOIDANCE}
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        initialFocus={false}
        instant
        positionerClassName="z-(--z-index-workbench-popover)"
        positionMethod="fixed"
        side="top"
        sideOffset={COMPOSER_MENU_SIDE_OFFSET}
        className={cn(
          // `relative` keeps the popup as the command-menu root for the fixed
          // path preview panel rendered inside it.
          "relative border-0 bg-transparent p-0 opacity-100 shadow-none before:hidden data-starting-style:scale-100 data-starting-style:opacity-100 [--viewport-inline-padding:0] *:data-[slot=popover-viewport]:overflow-visible *:data-[slot=popover-viewport]:p-0",
          // Cap height to match width pattern. Base UI's auto-resize measures
          // the popup with `--available-height: max-content`, which breaks
          // `min(20rem, var(--available-height))` and lets the popup grow to
          // its natural height; the positioner then gets sized past the
          // viewport and collision-shifts the popup off-screen.
          "max-h-[342px]",
          // Cursor parity: both menus use one 300px shell.
          "w-[300px] max-w-[min(300px,var(--available-width))]",
        )}
        data-composer-command-menu-root=""
        data-menu-kind={menuKind}
        data-anchor-revision={anchorRevision}
        data-menu-direction="up"
      >
        <ComposerCommandMenu menuKind={menuKind} {...menuProps} />
      </PopoverPopup>
    </Popover>
  );
}
