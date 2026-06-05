import { Tooltip, TooltipPopup, TooltipTrigger } from "@multi/multikit/tooltip";
import { cva } from "class-variance-authority";
import { IconBuildingBlocks, type CentralIconBaseProps } from "central-icons";
import { type ComponentType } from "react";

import { cn } from "~/lib/utils";
import {
  basenameOfPath,
  getVscodeIconUrlForEntry,
  inferEntryKindFromPath,
} from "../../shared/vscode-entry-icons";
import { commandText } from "./serialization";
import type {
  ComposerCommandPayload,
  ComposerInlineTokenPayload,
  ComposerMentionPayload,
  ComposerSkillPayload,
} from "./types";

function resolvedThemeFromDocument(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

const composerPromptChipVariants = cva(
  cn(
    "inline-flex min-w-0 max-w-(--multi-composer-chip-max-width) select-none items-center gap-0.5",
    "bg-transparent px-0 py-0 font-multi font-normal align-middle",
    "-mt-[3px] -ml-px text-(length:--multi-composer-chip-font-size) leading-(--multi-composer-chip-line-height)",
  ),
  {
    variants: {
      kind: {
        mention: "text-(--multi-composer-mention-text)",
        command: "rounded-[2px] text-(--multi-composer-command-text)",
        skill: "rounded-[2px] text-(--multi-composer-command-text)",
        "inline-token": "text-(--multi-composer-mention-text)",
      },
    },
  },
);

const composerPromptChipIconClass = "size-(--multi-composer-chip-icon-size) shrink-0";

export function ComposerMentionChip({
  label,
  lineEnd,
  lineStart,
  path,
}: ComposerMentionPayload) {
  const theme = resolvedThemeFromDocument();
  const displayedLabel = label ?? basenameOfPath(path);
  const chip = (
    <span
      className={composerPromptChipVariants({ kind: "mention" })}
      contentEditable={false}
      data-read-only-mention=""
      data-type="mentionNode"
      spellCheck={false}
    >
      <img
        alt=""
        aria-hidden="true"
        className={cn(composerPromptChipIconClass, "opacity-90")}
        loading="lazy"
        src={getVscodeIconUrlForEntry(path, inferEntryKindFromPath(path), theme)}
      />
      <span className="min-w-0 truncate">{displayedLabel}</span>
      {lineStart !== null && lineEnd !== null ? (
        <span className="shrink-0 text-(length:--multi-composer-chip-line-range-font-size) text-(--multi-composer-mention-line-range-text)">
          {lineStart === lineEnd ? `:${lineStart}` : `:${lineStart}-${lineEnd}`}
        </span>
      ) : null}
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup side="top" className="max-w-lg whitespace-normal text-xs/4 wrap-anywhere">
        {path}
      </TooltipPopup>
    </Tooltip>
  );
}

export function ComposerCommandChip({
  content,
  name,
}: ComposerCommandPayload) {
  const label = commandText({ name });
  const chip = (
    <span
      className={composerPromptChipVariants({ kind: "command" })}
      contentEditable={false}
      data-type="commandNode"
      spellCheck={false}
    >
      <button type="button" tabIndex={-1} className="truncate text-left hover:underline">
        {label}
      </button>
    </span>
  );

  return content ? (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup side="top" className="max-w-lg whitespace-normal text-xs/4">
        {content}
      </TooltipPopup>
    </Tooltip>
  ) : (
    chip
  );
}

const SkillIcon: ComponentType<CentralIconBaseProps> = IconBuildingBlocks;

export function ComposerSkillChip({
  description,
  label,
}: ComposerSkillPayload) {
  const chip = (
    <span
      className={composerPromptChipVariants({ kind: "skill" })}
      contentEditable={false}
      data-composer-skill-chip="true"
      spellCheck={false}
    >
      <span
        aria-hidden="true"
        className={cn(composerPromptChipIconClass, "text-(--multi-composer-command-text)")}
      >
        <SkillIcon className="size-(--multi-composer-chip-icon-size)" />
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );

  return description ? (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup side="top" className="max-w-lg whitespace-normal text-xs/4">
        {description}
      </TooltipPopup>
    </Tooltip>
  ) : (
    chip
  );
}

export function ComposerInlineTokenChip({
  label,
  sourceUri,
}: ComposerInlineTokenPayload) {
  const chip = (
    <span
      className={composerPromptChipVariants({ kind: "inline-token" })}
      contentEditable={false}
      data-composer-inline-token-chip="true"
      spellCheck={false}
    >
      <span className="min-w-0 truncate">{label || sourceUri}</span>
    </span>
  );

  return sourceUri ? (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup side="top" className="max-w-lg whitespace-normal text-xs/4">
        {sourceUri}
      </TooltipPopup>
    </Tooltip>
  ) : (
    chip
  );
}
