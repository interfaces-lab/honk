import * as stylex from "@stylexjs/stylex";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@honk/honkkit/tooltip";
import { IconBuildingBlocks, type CentralIconBaseProps } from "central-icons";
import { type ComponentType } from "react";

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
  if (typeof document === "undefined") {
    return "dark";
  }
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

const styles = stylex.create({
  chip: {
    alignItems: "center",
    borderRadius: "6px",
    display: "inline-flex",
    fontFamily: "var(--honk-font-ui)",
    fontSize: "var(--honk-composer-chip-font-size)",
    fontWeight: 400,
    gap: "4px",
    lineHeight: "var(--honk-composer-chip-line-height)",
    marginLeft: "-1px",
    marginTop: "-3px",
    minWidth: 0,
    paddingBlock: "1px",
    paddingLeft: "4px",
    paddingRight: "4px",
    userSelect: "none",
    verticalAlign: "middle",
  },
  bounded: {
    maxWidth: "var(--honk-composer-chip-max-width)",
  },
  mention: {
    backgroundColor: "var(--honk-composer-mention-background)",
    color: "var(--honk-composer-mention-text)",
  },
  command: {
    backgroundColor: "var(--honk-composer-command-background)",
    color: "var(--honk-composer-command-text)",
  },
  fileIcon: {
    display: "block",
    flexShrink: 0,
    height: "var(--honk-composer-chip-icon-size)",
    opacity: 0.9,
    width: "var(--honk-composer-chip-icon-size)",
  },
  iconSlot: {
    alignItems: "center",
    color: "inherit",
    display: "inline-flex",
    flexShrink: 0,
    height: "var(--honk-composer-chip-icon-size)",
    justifyContent: "center",
    width: "var(--honk-composer-chip-icon-size)",
  },
  label: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  lineRange: {
    color: "var(--honk-composer-mention-line-range-text)",
    flexShrink: 0,
    fontSize: "var(--honk-composer-chip-line-range-font-size)",
  },
  commandLabel: {
    color: "inherit",
    minWidth: 0,
    overflow: "hidden",
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

function chipProps(kind: "command" | "mention", bounded = true) {
  return stylex.props(
    styles.chip,
    bounded ? styles.bounded : null,
    kind === "command" ? styles.command : styles.mention,
  );
}

export function ComposerMentionChip({ label, lineEnd, lineStart, path }: ComposerMentionPayload) {
  const theme = resolvedThemeFromDocument();
  const displayedLabel = label ?? basenameOfPath(path);
  const chip = (
    <span
      {...chipProps("mention")}
      contentEditable={false}
      data-read-only-mention=""
      data-type="mentionNode"
      spellCheck={false}
    >
      <img
        {...stylex.props(styles.fileIcon)}
        alt=""
        aria-hidden="true"
        loading="lazy"
        src={getVscodeIconUrlForEntry(path, inferEntryKindFromPath(path), theme)}
      />
      <span {...stylex.props(styles.label)}>{displayedLabel}</span>
      {lineStart !== null && lineEnd !== null ? (
        <span {...stylex.props(styles.lineRange)}>
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

export function ComposerCommandChip({ content, name }: ComposerCommandPayload) {
  const label = commandText({ name });
  const chip = (
    <span
      {...chipProps("command")}
      contentEditable={false}
      data-type="commandNode"
      spellCheck={false}
    >
      <span {...stylex.props(styles.commandLabel)}>{label}</span>
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

/** Canonical skill glyph — shared by the inserted skill chip and the slash menu rows. */
export const SkillIcon: ComponentType<CentralIconBaseProps> = IconBuildingBlocks;

export function ComposerSkillChip({ description, label }: ComposerSkillPayload) {
  const chip = (
    <span
      {...chipProps("command", false)}
      contentEditable={false}
      data-composer-skill-chip="true"
      spellCheck={false}
    >
      <span {...stylex.props(styles.iconSlot)} aria-hidden="true">
        <SkillIcon ariaHidden size="var(--honk-composer-chip-icon-size)" />
      </span>
      <span>{label}</span>
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

export function ComposerInlineTokenChip({ label, sourceUri }: ComposerInlineTokenPayload) {
  const chip = (
    <span
      {...chipProps("mention")}
      contentEditable={false}
      data-composer-inline-token-chip="true"
      spellCheck={false}
    >
      <span {...stylex.props(styles.label)}>{label || sourceUri}</span>
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
