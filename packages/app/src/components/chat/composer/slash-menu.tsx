import {
  type ProjectEntry,
  type EnvironmentId,
  type ProviderDriverKind,
  type ServerProvider,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
} from "@multi/contracts";
import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
} from "@multi/shared/search-ranking";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import {
  IconBuildingBlocks,
  IconBox2,
  IconRobot,
  IconSettingsSliderHor,
  IconSquareChecklist,
  type CentralIconBaseProps,
} from "central-icons";
import {
  memo,
  useCallback,
  useMemo,
  type ComponentProps,
  type ComponentType,
} from "react";

import { Popover, PopoverPopup } from "@multi/ui/popover";
import { cn } from "~/lib/utils";

import {
  type ComposerSlashCommand,
  type ComposerTrigger,
  type ComposerTriggerKind,
} from "./prompt-triggers";
import { basenameOfPath } from "../shared/vscode-entry-icons";
import { projectSearchEntriesQueryOptions } from "~/lib/project-react-query";
import { formatProviderSkillDisplayName } from "./provider-skills";
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@multi/ui/command";
import { VscodeEntryIcon } from "../shared/vscode-entry-icon";

const PATH_QUERY_DEBOUNCE_MS = 120;
const COMPOSER_MENU_SIDE_OFFSET = 3;
const EMPTY_PROJECT_ENTRIES: ProjectEntry[] = [];
type CentralIconComponent = ComponentType<CentralIconBaseProps>;

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
      type: "provider-slash-command";
      provider: ProviderDriverKind;
      command: ServerProviderSlashCommand;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "skill";
      provider: ProviderDriverKind;
      skill: ServerProviderSkill;
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
    .getPropertyValue("--multi-composer-menu-collision-padding-top")
    .trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 8;
}

function composerMenuCollisionPadding() {
  const top = readComposerMenuCollisionPaddingTop();
  return { top, bottom: 8, left: 8, right: 8 } as const;
}

function titleCaseWords(value: string): string {
  return value
    .split(/[\s:_-]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatProviderSkillInstallSource(
  skill: Pick<ServerProviderSkill, "path" | "scope">,
): string | null {
  const normalizedPath = skill.path.replaceAll("\\", "/");
  if (normalizedPath.includes("/.codex/plugins/") || normalizedPath.includes("/.agents/plugins/")) {
    return "App";
  }

  const normalizedScope = skill.scope?.trim().toLowerCase();
  if (normalizedScope === "system") return "System";
  if (normalizedScope === "project" || normalizedScope === "local" || normalizedScope === "repo") {
    return "Project";
  }
  if (normalizedScope === "admin") return "Admin";
  if (normalizedScope === "user" || normalizedScope === "personal") return "Personal";
  return normalizedScope ? titleCaseWords(normalizedScope) : null;
}

function skillDescription(skill: ServerProviderSkill): string {
  return (
    skill.shortDescription ??
    skill.description ??
    (skill.scope ? `${skill.scope} skill` : "Run provider skill")
  );
}

function toProviderSkillItem(
  provider: ProviderDriverKind,
  skill: ServerProviderSkill,
): Extract<ComposerCommandItem, { type: "skill" }> {
  const displayName = formatProviderSkillDisplayName(skill);
  const description = skillDescription(skill);
  return {
    id: `skill:${provider}:${skill.name}`,
    type: "skill",
    provider,
    skill,
    label: `/${skill.name}`,
    description: description === displayName ? "Provider skill" : `${displayName}: ${description}`,
  };
}

function scoreProviderSkill(skill: ServerProviderSkill, query: string): number | null {
  const normalizedName = skill.name.toLowerCase();
  const normalizedLabel = formatProviderSkillDisplayName(skill).toLowerCase();
  const normalizedShortDescription = skill.shortDescription?.toLowerCase() ?? "";
  const normalizedDescription = skill.description?.toLowerCase() ?? "";
  const normalizedScope = skill.scope?.toLowerCase() ?? "";

  const scores = [
    scoreQueryMatch({
      value: normalizedName,
      query,
      exactBase: 0,
      prefixBase: 2,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 100,
      boundaryMarkers: ["-", "_", "/"],
    }),
    scoreQueryMatch({
      value: normalizedLabel,
      query,
      exactBase: 1,
      prefixBase: 3,
      boundaryBase: 5,
      includesBase: 7,
      fuzzyBase: 110,
    }),
    scoreQueryMatch({
      value: normalizedShortDescription,
      query,
      exactBase: 20,
      prefixBase: 22,
      boundaryBase: 24,
      includesBase: 26,
    }),
    scoreQueryMatch({
      value: normalizedDescription,
      query,
      exactBase: 30,
      prefixBase: 32,
      boundaryBase: 34,
      includesBase: 36,
    }),
    scoreQueryMatch({
      value: normalizedScope,
      query,
      exactBase: 40,
      prefixBase: 42,
      includesBase: 44,
    }),
  ].filter((score): score is number => score !== null);

  return scores.length > 0 ? Math.min(...scores) : null;
}

function searchProviderSkills(
  skills: ReadonlyArray<ServerProviderSkill>,
  query: string,
  limit = Number.POSITIVE_INFINITY,
): ServerProviderSkill[] {
  const enabledSkills = skills.filter((skill) => skill.enabled);
  const normalizedQuery = normalizeSearchQuery(query, { trimLeadingPattern: /^\/+/ });
  if (!normalizedQuery) {
    return enabledSkills;
  }

  const ranked: Array<{ item: ServerProviderSkill; score: number; tieBreaker: string }> = [];
  for (const skill of enabledSkills) {
    const score = scoreProviderSkill(skill, normalizedQuery);
    if (score === null) continue;
    insertRankedSearchResult(
      ranked,
      {
        item: skill,
        score,
        tieBreaker: `${formatProviderSkillDisplayName(skill).toLowerCase()}\u0000${skill.name}`,
      },
      limit,
    );
  }
  return ranked.map((entry) => entry.item);
}

function collectProviderSkillItems(
  providerStatuses: ReadonlyArray<ServerProvider>,
): Array<Extract<ComposerCommandItem, { type: "skill" }>> {
  const items: Array<Extract<ComposerCommandItem, { type: "skill" }>> = [];
  const seen = new Set<string>();
  for (const providerStatus of providerStatuses) {
    for (const skill of searchProviderSkills(providerStatus.skills, "")) {
      const key = `${skill.path}\u0000${skill.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(toProviderSkillItem(providerStatus.driver, skill));
    }
  }
  return items;
}

function scoreSlashCommandItem(
  item: Extract<
    ComposerCommandItem,
    { type: "slash-command" | "provider-slash-command" | "skill" }
  >,
  query: string,
): number | null {
  const primaryValue =
    item.type === "slash-command"
      ? item.command.toLowerCase()
      : item.type === "provider-slash-command"
        ? item.command.name.toLowerCase()
        : item.skill.name.toLowerCase();
  const displayValue =
    item.type === "skill"
      ? formatProviderSkillDisplayName(item.skill).toLowerCase()
      : item.label.toLowerCase();
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
  items: ReadonlyArray<
    Extract<ComposerCommandItem, { type: "slash-command" | "provider-slash-command" | "skill" }>
  >,
  query: string,
): Array<
  Extract<ComposerCommandItem, { type: "slash-command" | "provider-slash-command" | "skill" }>
> {
  const normalizedQuery = normalizeSearchQuery(query, { trimLeadingPattern: /^\/+/ });
  if (!normalizedQuery) {
    return [...items];
  }

  const ranked: Array<{
    item: Extract<
      ComposerCommandItem,
      { type: "slash-command" | "provider-slash-command" | "skill" }
    >;
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
        tieBreaker:
          item.type === "slash-command"
            ? `0\u0000${item.command}`
            : item.type === "provider-slash-command"
              ? `1\u0000${item.command.name}\u0000${item.provider}`
              : [
                  "2",
                  formatProviderSkillDisplayName(item.skill).toLowerCase(),
                  item.skill.name,
                  item.provider,
                ].join("\u0000"),
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
  composerTrigger: ComposerTrigger | null;
  environmentId: EnvironmentId;
  gitCwd: string | null;
  selectedProvider: ProviderDriverKind;
  selectedProviderStatus: ServerProvider | null | undefined;
  providerStatuses: ReadonlyArray<ServerProvider>;
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

  const composerMenuItems = useMemo<ComposerCommandItem[]>(() => {
    if (!input.composerTrigger) return [];
    if (input.composerTrigger.kind === "path") {
      return toPathCommandItems(projectEntries);
    }
    if (input.composerTrigger.kind !== "slash-command") {
      return [];
    }

    const builtInSlashCommandItems = [
      {
        id: "slash:model",
        type: "slash-command",
        command: "model",
        label: "/model",
        description: "Switch response model for this thread",
      },
      {
        id: "slash:plan",
        type: "slash-command",
        command: "plan",
        label: "/plan",
        description: "Switch this thread into plan mode",
      },
      {
        id: "slash:default",
        type: "slash-command",
        command: "default",
        label: "/default",
        description: "Switch this thread back to normal build mode",
      },
    ] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;
    const providerSlashCommandItems = (input.selectedProviderStatus?.slashCommands ?? []).map(
      (command) => ({
        id: `provider-slash-command:${input.selectedProvider}:${command.name}`,
        type: "provider-slash-command" as const,
        provider: input.selectedProvider,
        command,
        label: `/${command.name}`,
        description: command.description ?? command.input?.hint ?? "Run provider command",
      }),
    );
    const providerSkillItems = collectProviderSkillItems(input.providerStatuses);
    const slashItems = [
      ...providerSkillItems,
      ...providerSlashCommandItems,
      ...builtInSlashCommandItems,
    ];
    const query = input.composerTrigger.query.trim();
    const matchingSlashItems = query ? searchSlashCommandItems(slashItems, query) : slashItems;
    return matchingSlashItems;
  }, [
    input.composerTrigger,
    input.providerStatuses,
    input.selectedProvider,
    input.selectedProviderStatus,
    projectEntries,
  ]);

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
  const activeComposerMenuItemId = useMemo(
    () =>
      resolveComposerMenuActiveItemId({
        items: composerMenuItems,
        highlightedItemId: input.highlightedItemId,
        currentSearchKey: composerMenuSearchKey,
        highlightedSearchKey: input.highlightedSearchKey,
      }),
    [input.highlightedItemId, input.highlightedSearchKey, composerMenuItems, composerMenuSearchKey],
  );
  const activeComposerMenuItem = useMemo(
    () => composerMenuItems.find((item) => item.id === activeComposerMenuItemId) ?? null,
    [activeComposerMenuItemId, composerMenuItems],
  );

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

function getSlashCommandIcon(command: ComposerSlashCommand): CentralIconComponent {
  if (command === "model") return IconBox2;
  if (command === "plan") return IconSquareChecklist;
  return IconRobot;
}

function getSlashCommandTertiaryText(command: ComposerSlashCommand): string {
  if (command === "model") return "Select Model";
  if (command === "plan") return "Plan Mode";
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

  const modeItems = items.filter(
    (item) => item.type === "slash-command" && item.command !== "model",
  );
  const modelItems = items.filter(
    (item) => item.type === "slash-command" && item.command === "model",
  );
  const providerItems = items.filter((item) => item.type === "provider-slash-command");
  const skillItems = items.filter((item) => item.type === "skill");

  const groups: ComposerCommandGroup[] = [];
  if (skillItems.length > 0) {
    groups.push({ id: "skills", label: "Skills", items: skillItems });
  }
  if (providerItems.length > 0) {
    groups.push({ id: "commands", label: "Commands", items: providerItems });
  }
  if (modeItems.length > 0) {
    groups.push({ id: "modes", label: "Modes", items: modeItems });
  }
  if (modelItems.length > 0) {
    groups.push({ id: "models", label: "Models", items: modelItems });
  }
  return groups;
}

export const ComposerCommandMenu = memo(function ComposerCommandMenu(props: {
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
  const groups = useMemo(
    () =>
      groupCommandItems(
        props.items,
        props.triggerKind,
        props.groupSlashCommandSections ?? true,
        props.isSearching ?? false,
      ),
    [props.groupSlashCommandSections, props.isSearching, props.items, props.triggerKind],
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
        className="relative w-full max-w-full min-w-0 overflow-hidden rounded-lg border border-multi-stroke-secondary bg-[color-mix(in_srgb,var(--multi-chat-bubble-opaque-background)_96%,transparent)] font-multi text-body text-multi-fg-primary shadow-multi-popup motion-reduce:animate-none motion-reduce:transition-none"
        data-menu-kind={props.menuKind}
        data-variant="surface"
      >
        <CommandList className="max-h-[min(20rem,var(--available-height))] overflow-y-auto">
          {groups.map((group, groupIndex) => (
            <div key={group.id}>
              {groupIndex > 0 ? <CommandSeparator className="my-px" /> : null}
              <CommandGroup>
                {group.label ? (
                  <CommandGroupLabel className="px-1.5 py-0.5 text-detail font-medium text-multi-fg-tertiary opacity-60">
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
            <p className="text-body text-multi-fg-tertiary">
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
});

const ComposerCommandMenuItem = memo(function ComposerCommandMenuItem(props: {
  item: ComposerCommandItem;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
  onHighlight: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const scrollActiveItemIntoView = useCallback(
    (node: HTMLElement | null) => {
      if (!node || !props.isActive) return;
      node.scrollIntoView({ block: "nearest" });
    },
    [props.isActive],
  );
  const skillSourceLabel =
    props.item.type === "skill" ? formatProviderSkillInstallSource(props.item.skill) : null;
  const SlashIcon =
    props.item.type === "slash-command" ? getSlashCommandIcon(props.item.command) : null;
  const tertiaryText =
    props.item.type === "slash-command"
      ? getSlashCommandTertiaryText(props.item.command)
      : props.item.type === "provider-slash-command"
        ? "Command"
        : skillSourceLabel;

  return (
    <CommandItem
      ref={props.isActive ? scrollActiveItemIntoView : undefined}
      value={props.item.id}
      data-composer-item-id={props.item.id}
      data-is-selected={props.isActive ? "" : undefined}
      data-menu-item-type={props.item.type}
      className="flex min-h-[22px] cursor-pointer items-center gap-1.5 rounded-multi-control px-1.5 py-1 text-body text-multi-fg-primary select-none hover:bg-multi-bg-quaternary data-highlighted:bg-multi-bg-quaternary data-[is-selected]:bg-multi-bg-quaternary"
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
      {SlashIcon ? <SlashIcon className="size-4 shrink-0 text-multi-fg-secondary" /> : null}
      {props.item.type === "provider-slash-command" ? (
        <span className="inline-flex size-4 shrink-0 items-center justify-center text-multi-fg-secondary">
          <IconSettingsSliderHor className="size-3.5" />
        </span>
      ) : null}
      {props.item.type === "skill" ? (
        <span className="inline-flex size-4 shrink-0 items-center justify-center text-multi-fg-secondary">
          <IconBuildingBlocks className="size-3.5" />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="min-w-0 flex-none truncate text-body font-medium text-multi-fg-primary">
          {props.item.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-detail text-multi-fg-tertiary">
          {props.item.description}
        </span>
      </span>
      {tertiaryText ? (
        <span className="flex-none whitespace-nowrap rounded-full border border-multi-stroke-secondary bg-multi-bg-tertiary/70 px-1.5 py-0 text-caption text-multi-fg-tertiary">
          {tertiaryText}
        </span>
      ) : null}
    </CommandItem>
  );
});

type ComposerCommandMenuAnchor = ComponentProps<typeof PopoverPopup>["anchor"];

type ComposerCommandMenuPositionedProps = ComponentProps<typeof ComposerCommandMenu> & {
  open: boolean;
  anchor: ComposerCommandMenuAnchor;
  anchorVersion: number;
};

export const ComposerCommandMenuPositioned = memo(function ComposerCommandMenuPositioned(
  props: ComposerCommandMenuPositionedProps,
) {
  const { open, anchor, anchorVersion, menuKind, ...menuProps } = props;
  const collisionPadding = useMemo(
    () => (open ? composerMenuCollisionPadding() : { top: 8, bottom: 8, left: 8, right: 8 }),
    [open],
  );
  const collisionBoundary = typeof document === "undefined" ? undefined : document.documentElement;

  return (
    <Popover open={open}>
      <PopoverPopup
        key={anchorVersion}
        anchor={anchor}
        align="start"
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        initialFocus={false}
        instant
        side="top"
        sideOffset={COMPOSER_MENU_SIDE_OFFSET}
        className={cn(
          "z-[70] border-0 bg-transparent p-0 opacity-100 shadow-none before:hidden data-starting-style:scale-100 data-starting-style:opacity-100 [--viewport-inline-padding:0] *:data-[slot=popover-viewport]:overflow-visible *:data-[slot=popover-viewport]:p-0",
          menuKind === "mentions"
            ? "w-64 max-w-[min(16rem,var(--available-width))]"
            : "w-80 max-w-[min(20rem,var(--available-width))]",
        )}
        data-composer-command-menu-root=""
        data-menu-kind={menuKind}
      >
        <ComposerCommandMenu menuKind={menuKind} {...menuProps} />
      </PopoverPopup>
    </Popover>
  );
});
