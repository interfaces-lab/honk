import {
  type ProjectEntry,
  type ProviderDriverKind,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
} from "@multi/contracts";
import {
  IconBuildingBlocks,
  IconBox2,
  IconRobot,
  IconSettingsSliderHor,
  IconSquareChecklist,
  type CentralIconBaseProps,
} from "central-icons";
type CentralIconComponent = React.ComponentType<CentralIconBaseProps>;
import { memo, useLayoutEffect, useMemo, useRef } from "react";

import { type ComposerSlashCommand, type ComposerTriggerKind } from "../../../composer-logic";
import { formatProviderSkillInstallSource } from "~/provider-skill-presentation";
import { cn } from "~/lib/utils";
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@multi/ui/command";
import { VscodeEntryIcon } from "../shared/vscode-entry-icon";

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
): ComposerCommandGroup[] {
  if (triggerKind === "skill") {
    return items.length > 0 ? [{ id: "skills", label: "Skills", items }] : [];
  }
  if (triggerKind === "path") {
    return items.length > 0 ? [{ id: "files", label: "Files & Folders", items }] : [];
  }
  if (triggerKind !== "slash-command" || !groupSlashCommandSections) {
    return [{ id: "default", label: null, items }];
  }

  const modeItems = items.filter(
    (item) => item.type === "slash-command" && item.command !== "model",
  );
  const openItems = items.filter(
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
  if (openItems.length > 0) {
    groups.push({ id: "open", label: "Open", items: openItems });
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
  emptyStateText?: string;
  activeItemId: string | null;
  onHighlightedItemChange: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(
    () =>
      groupCommandItems(props.items, props.triggerKind, props.groupSlashCommandSections ?? true),
    [props.groupSlashCommandSections, props.items, props.triggerKind],
  );

  useLayoutEffect(() => {
    if (!props.activeItemId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-composer-item-id="${CSS.escape(props.activeItemId)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [props.activeItemId]);

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
        ref={listRef}
        className={cn(
          "relative max-w-full min-w-[min(var(--composer-menu-width),calc(100vw-32px))] overflow-hidden rounded-[8px] border border-multi-stroke-secondary bg-[color-mix(in_srgb,var(--glass-chat-bubble-opaque-background)_96%,transparent)] font-multi text-[12px]/[16px] text-multi-fg-primary shadow-multi-popup backdrop-blur-[18px] motion-reduce:animate-none motion-reduce:transition-none",
          props.menuKind === "slash" && "max-w-[320px]",
          "ui-slash-menu__content ui-slash-menu__content--glass",
          props.menuKind === "slash" ? "ui-slash-menu" : "mentions-menu mentions-menu__content",
          props.menuKind === "mentions" && "w-[250px]",
        )}
        data-menu-kind={props.menuKind}
        data-variant="glass"
      >
        <CommandList className="max-h-[342px]">
          {groups.map((group, groupIndex) => (
            <div key={group.id} className="ui-menu__section">
              {groupIndex > 0 ? <CommandSeparator className="my-px" /> : null}
              <CommandGroup>
                {group.label ? (
                  <CommandGroupLabel className="ui-menu__section-title px-1.5 py-0.5 text-[11px]/[15px] font-medium text-multi-fg-tertiary opacity-60">
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
          <div className="ui-menu__empty px-[10px] py-2">
            {props.triggerKind === "skill" ? (
              <CommandGroup>
                <CommandGroupLabel className="ui-menu__section-title px-0! pt-0! pb-[3px] text-[10px]/[14px] font-semibold tracking-[0.08em] text-multi-fg-tertiary uppercase">
                  Skills
                </CommandGroupLabel>
                <p className="text-[12px]/[18px] text-multi-fg-tertiary">
                  {props.isLoading
                    ? "Searching project skills..."
                    : (props.emptyStateText ??
                      "No skills found. Try / to browse provider commands.")}
                </p>
              </CommandGroup>
            ) : (
              <p className="text-[12px]/[18px] text-multi-fg-tertiary">
                {props.isLoading
                  ? "Searching project files..."
                  : (props.emptyStateText ??
                    (props.triggerKind === "path"
                      ? "No matching files or folders."
                      : "No matching command."))}
              </p>
            )}
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
      value={props.item.id}
      data-composer-item-id={props.item.id}
      data-is-selected={props.isActive ? "" : undefined}
      data-menu-item-type={props.item.type}
      className="ui-slash-menu__item ui-menu__item flex min-h-[22px] cursor-pointer items-center gap-1.5 rounded-[6px] px-1.5 py-[3px] text-[12px]/[16px] text-multi-fg-primary select-none hover:bg-multi-bg-quaternary data-highlighted:bg-multi-bg-quaternary data-[is-selected]:bg-multi-bg-quaternary"
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
      {SlashIcon ? (
        <SlashIcon className="ui-slash-menu__item-icon size-4 shrink-0 text-multi-fg-secondary" />
      ) : null}
      {props.item.type === "provider-slash-command" ? (
        <span className="ui-slash-menu__item-icon inline-flex size-4 shrink-0 items-center justify-center text-multi-fg-secondary">
          <IconSettingsSliderHor className="size-3.5" />
        </span>
      ) : null}
      {props.item.type === "skill" ? (
        <span className="ui-slash-menu__item-icon inline-flex size-4 shrink-0 items-center justify-center text-multi-fg-secondary">
          <IconBuildingBlocks className="size-3.5" />
        </span>
      ) : null}
      <span className="ui-slash-menu__item-title-wrap flex min-w-0 flex-1 items-baseline gap-2">
        <span className="ui-slash-menu__item-title min-w-0 flex-none truncate text-[12px]/[16px] font-medium text-multi-fg-primary">
          {props.item.label}
        </span>
        <span className="ui-menu__item-description ui-slash-menu__item-inline-description min-w-0 flex-1 truncate text-[11px]/[16px] text-multi-fg-tertiary">
          {props.item.description}
        </span>
      </span>
      {tertiaryText ? (
        <span className="ui-slash-menu__item-tertiary-text flex-none whitespace-nowrap rounded-full border border-multi-stroke-secondary bg-multi-bg-tertiary/70 px-1.5 py-0 text-[10px]/[14px] text-multi-fg-tertiary">
          {tertiaryText}
        </span>
      ) : null}
    </CommandItem>
  );
});
