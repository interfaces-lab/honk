import { FileTypeIcon, Icon, Tooltip, type Glyph } from "@honk/ui";
import { IconBuildingBlocks, IconCrossSmall } from "@honk/ui/icons";
import { composerVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { splitSkillReferences } from "./submission";

const CHIP_MAX_WIDTH = "240px";

// Cursor's prompt references are specialized text, not attachment pills: no extra box geometry,
// one cyan foreground for glyph and label, and the editor selection color when Lexical selects one.
export const chipStyles = stylex.create({
  chip: {
    display: "inline-flex",
    alignItems: "baseline",
    verticalAlign: "baseline",
    boxSizing: "border-box",
    maxWidth: CHIP_MAX_WIDTH,
    minWidth: 0,
    whiteSpace: "nowrap",
    padding: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    color: composerVars["--honk-composer-reference-foreground"],
    "--_chip-remove-display": {
      default: "none",
      "@media (hover: none)": "inline-flex",
      ":hover": { "@media (hover: hover)": "inline-flex" },
    },
  },
  selected: {
    backgroundColor: composerVars["--honk-composer-selection-background"],
  },
  icon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    // The chip aligns on the text baseline, but the glyph centers on the 21px composer line box:
    // that lands within 0.3px of the 14px cap-height midpoint, which is where the eye reads it.
    alignSelf: "center",
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor's fixed icon-to-label gap is 4px; no Honk spacing token owns it.
    marginInlineEnd: "4px",
  },
  label: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  width: {
    maxWidth: CHIP_MAX_WIDTH,
  },
  // The reference reads as text at rest, so its remove control leaves no blank inline footprint.
  // Hover-capable pointers reveal it on the chip; non-hover devices render it up front so a tap can
  // target the button directly.
  remove: {
    appearance: "none",
    display: "var(--_chip-remove-display)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    alignSelf: "center",
    padding: 0,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    color: "inherit",
    // oxlint-disable-next-line honk/design-no-raw-values -- Mirrors the chip's own 4px icon gap.
    marginInlineStart: "4px",
  },
});

// One inline reference: glyph, label, and a remove control that stays invisible until the pointer is
// on the chip, or stays visible when the device has no hover. Removal is a pointer convenience over
// Backspace, which deletes the same chip as a unit, so the control is kept out of the accessibility
// tree rather than offered unfocusably.
export function Chip({
  icon,
  label,
  tooltip,
  isSelected,
  onRemove,
}: {
  readonly icon: React.ReactElement;
  readonly label: string;
  readonly tooltip: React.ReactNode;
  readonly isSelected: boolean;
  readonly onRemove: () => void;
}): React.ReactElement {
  return (
    <Tooltip label={tooltip}>
      <span {...stylex.props(chipStyles.chip, isSelected && chipStyles.selected)}>
        {icon}
        <span {...stylex.props(chipStyles.label)}>{label}</span>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          data-canonical-control-exception="Inline prompt reference: an IconButton's box chrome would break the chip's text flow, and Backspace removes the same chip from the keyboard."
          {...stylex.props(chipStyles.remove)}
          // The chip lives in the contenteditable; suppressing both press events keeps the click
          // from moving the caret or collapsing the user's selection before removal runs.
          onPointerDown={(event) => {
            event.preventDefault();
          }}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={onRemove}
        >
          <Icon icon={IconCrossSmall} size="xs" />
        </button>
      </span>
    </Tooltip>
  );
}

export function SkillText({ text }: { readonly text: string }): React.ReactNode {
  const segments = splitSkillReferences(text);
  if (segments.every((segment) => segment.type === "text")) return text;
  return (
    <>
      {segments.map((segment) =>
        segment.type === "text" ? (
          <React.Fragment key={segment.offset}>{segment.value}</React.Fragment>
        ) : (
          <span key={segment.offset} title={segment.path} {...stylex.props(chipStyles.chip)}>
            <ChipIcon icon={IconBuildingBlocks} />
            <span {...stylex.props(chipStyles.label)}>{`/${segment.name}`}</span>
          </span>
        ),
      )}
    </>
  );
}

function ChipIcon({ icon }: { readonly icon: Glyph }): React.ReactElement {
  return (
    <span aria-hidden {...stylex.props(chipStyles.icon)}>
      <Icon icon={icon} size="xs" />
    </span>
  );
}

function FileChipIcon({ path }: { readonly path: string }): React.ReactElement {
  return (
    <span aria-hidden {...stylex.props(chipStyles.icon)}>
      <FileTypeIcon path={path} size="xs" />
    </span>
  );
}

export { ChipIcon, FileChipIcon };
