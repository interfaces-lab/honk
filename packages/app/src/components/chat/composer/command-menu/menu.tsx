import { type ProjectEntry, type EnvironmentId } from "@honk/contracts";
import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
} from "@honk/shared/search-ranking";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { IconBug, IconBubbleQuestion, IconRobot, IconSquareChecklist } from "central-icons";
import { useMemo, type ComponentProps } from "react";

import { Popover, PopoverPopup } from "@honk/multikit/popover";
import { cn } from "~/lib/utils";

import {
  type ComposerSlashCommand,
  type ComposerTrigger,
  type ComposerTriggerKind,
} from "../prompt-triggers";
import { basenameOfPath } from "../../shared/vscode-entry-icons";
import type { ComposerMenuPopoverAnchor } from "./anchor";
import { projectSearchEntriesQueryOptions } from "~/lib/project-react-query";
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@honk/multikit/command";
import { VscodeEntryIcon } from "../../shared/vscode-entry-icon";

/**
 * Composer command menu (`/` slash commands and `@` mentions).
 *
 * Both menus render through `ComposerCommandMenuPositioned`. See AGENTS.md
 * "Composer command menu" for the full contract. In short:
 *
 * - Anchor: live DOM rect from `prompt-editor.tsx` caret span via
 *   `composerMenuPopoverAnchorFromElement` in `input.tsx`.
 * - Placement: `side="top"`, `positionMethod="fixed"`, dropdown collision
 *   (`shift`, `fallbackAxisSide: "none"`), no popover remount on caret moves.
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

function searchSlashCommandItems(
  items: ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>,
  query: string,
): Array<Extract<ComposerCommandItem, { type: "slash-command" }>> {
  const normalizedQuery = normalizeSearchQuery(query, { trimLeadingPattern: /^\/+/ });
  if (!normalizedQuery) {
    return [...items];
  }

  const ranked: Array<{
    item: Extract<ComposerCommandItem, { type: "slash-command" }>;
    score: number;
    tieBreaker: string;
  }> = [];

  for (const item of items) {
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

  return ranked.map((entry) => entry.item);
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
  allowModeSlashCommands?: boolean | undefined;
  composerTrigger: ComposerTrigger | null;
  environmentId: EnvironmentId;
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
      limit: 80,
    }),
  );
  const projectEntries = projectEntriesQuery.data?.entries ?? EMPTY_PROJECT_ENTRIES;

  const composerMenuItems: ComposerCommandItem[] = (() => {
    if (!input.composerTrigger) return [];
    if (input.composerTrigger.kind === "path") {
      return toPathCommandItems(projectEntries);
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
        {
          id: "slash:agent",
          type: "slash-command",
          command: "agent",
          label: "/build",
          description: "Switch this thread back to Build mode",
        },
      );
    }
    const slashItems = builtInSlashCommandItems;
    const query = input.composerTrigger.query.trim();
    const matchingSlashItems = query ? searchSlashCommandItems(slashItems, query) : slashItems;
    return matchingSlashItems;
  })();

  const slashQueryHasMatches =
    composerTriggerKind !== "slash-command" ||
    slashTriggerQuery.trim().length === 0 ||
    composerMenuItems.length > 0;
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

  const isComposerMenuLoading =
    shouldSearchProjectEntries &&
    ((pathTriggerQuery.length > 0 && pathQueryDebouncer.state.isPending) ||
      projectEntriesQuery.isLoading ||
      projectEntriesQuery.isFetching);
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
    return items.length > 0 ? [{ id: "files", label: "Files & Folders", items }] : [];
  }
  if (triggerKind !== "slash-command" || !groupSlashCommandSections) {
    return [{ id: "default", label: null, items }];
  }
  if (isSearching) {
    return items.length > 0 ? [{ id: "results", label: "Results", items }] : [];
  }

  return items.length > 0 ? [{ id: "modes", label: "Modes", items }] : [];
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
  onHighlightedItemChange: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const groups = groupCommandItems(
    props.items,
    props.triggerKind,
    props.groupSlashCommandSections ?? true,
    props.isSearching ?? false,
  );

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
        className="relative w-full max-w-full min-w-0 overflow-hidden rounded-lg border border-honk-stroke-secondary bg-(--honk-composer-popup-surface-background) font-honk text-body text-honk-fg-primary shadow-honk-popup motion-reduce:animate-none motion-reduce:transition-none"
        data-menu-kind={props.menuKind}
        data-variant="surface"
      >
        {/* 340px = 342px popup shell cap minus the 1px top/bottom border. */}
        <CommandList className="max-h-[min(340px,var(--available-height))] overflow-y-auto">
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
  const slashIcon =
    props.item.type === "slash-command" ? renderSlashCommandIcon(props.item.command) : null;
  const tertiaryText =
    props.item.type === "slash-command" ? getSlashCommandTertiaryText(props.item.command) : null;

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
      {slashIcon}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="min-w-0 flex-none truncate text-body font-medium text-honk-fg-primary">
          {props.item.label}
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
  // The caret anchor is a virtual element (no DOM node), so Base UI's autoUpdate cannot
  // observe it. A new anchor identity per revision re-runs Floating UI positioning when
  // the caret span moves (Cursor-style MutationObserver → updateFloating). Do not
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
          "border-0 bg-transparent p-0 opacity-100 shadow-none before:hidden data-starting-style:scale-100 data-starting-style:opacity-100 [--viewport-inline-padding:0] *:data-[slot=popover-viewport]:overflow-visible *:data-[slot=popover-viewport]:p-0",
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
