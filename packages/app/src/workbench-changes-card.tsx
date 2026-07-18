import type { OpenCodeVcsFileStatus } from "@honk/opencode";
import { basename, normalizePathSeparators } from "@honk/shared/paths";
import { Checkbox, Icon, IconButton, Spinner, Text } from "@honk/ui";
import { IconChevronDownMedium, IconChevronRightMedium, IconClipboard } from "@honk/ui/icons";
import { borderVars, colorVars, controlVars, fontVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { PatchDiff } from "@pierre/diffs/react";
import * as React from "react";

import { buildDiffOptions } from "./lib/diff-rendering";

const styles = stylex.create({
  root: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    borderBlockEndWidth: borderVars["--honk-border-hairline"],
    borderBlockEndStyle: "solid",
    borderBlockEndColor: colorVars["--honk-color-border-muted"],
  },
  rootViewed: {
    opacity: 0.55,
  },
  header: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    minHeight: controlVars["--honk-control-h-sm"],
    paddingBlock: 0,
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    userSelect: "none",
    cursor: "pointer",
    backgroundColor: {
      default: "transparent",
      ":hover": colorVars["--honk-color-layer-01"],
    },
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: `calc(-1 * ${controlVars["--honk-control-focus-ring-offset"]})`,
    borderRadius: radiusVars["--honk-radius-control"],
  },
  chevron: {
    flexShrink: 0,
    color: colorVars["--honk-color-text-faint"],
  },
  glyph: {
    flexShrink: 0,
    width: "1em",
    textAlign: "center",
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-caption"],
  },
  glyphAdded: {
    color: colorVars["--honk-color-diff-addition"],
  },
  glyphDeleted: {
    color: colorVars["--honk-color-diff-deletion"],
  },
  glyphModified: {
    color: colorVars["--honk-color-text-faint"],
  },
  path: {
    display: "flex",
    flexGrow: 1,
    minWidth: 0,
    alignItems: "baseline",
    overflow: "hidden",
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  pathDir: {
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-muted"],
  },
  pathName: {
    flexShrink: 0,
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-primary"],
  },
  stats: {
    flexShrink: 0,
    display: "inline-flex",
    gap: spaceVars["--honk-space-gutter"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-caption"],
    fontVariantNumeric: "tabular-nums",
  },
  additions: {
    color: colorVars["--honk-color-diff-addition"],
  },
  deletions: {
    color: colorVars["--honk-color-diff-deletion"],
  },
  guard: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
  },
  body: {
    minWidth: 0,
    userSelect: "text",
    backgroundColor: colorVars["--honk-color-bg-base"],
  },
  placeholder: {
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px hairline gap between the two placeholder lines; tightest spacing token is 6px
    gap: "2px",
    paddingBlock: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
  },
  loading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    paddingBlock: spaceVars["--honk-space-panel-pad"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
  },
});

function fileStatusGlyph(status: OpenCodeVcsFileStatus["status"]): "A" | "D" | "M" {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "modified":
      return "M";
  }
}

function placeholderMessage(status: OpenCodeVcsFileStatus["status"]): {
  readonly title: string;
  readonly detail: string;
} {
  switch (status) {
    case "added":
      return { title: "New file", detail: "Honk has no line diff to render for this addition." };
    case "deleted":
      return { title: "File deleted", detail: "The file was removed from the working tree." };
    case "modified":
      return {
        title: "No diff available",
        detail: "Honk does not show binary or oversized diffs.",
      };
  }
}

function splitPath(file: string): { readonly dir: string; readonly name: string } {
  const normalized = normalizePathSeparators(file);
  const name = basename(normalized);
  const dir = normalized.slice(0, Math.max(0, normalized.length - name.length));
  return { dir, name };
}

function WorkbenchChangesCard({
  file,
  patch,
  patchPending,
  diffStyle,
  theme,
  isExpanded,
  onToggleExpand,
  isViewed,
  onToggleViewed,
}: {
  readonly file: OpenCodeVcsFileStatus;
  readonly patch: string | undefined;
  // While the diff stream is still resolving, an absent patch means "loading", not "no diff".
  readonly patchPending: boolean;
  readonly diffStyle: "unified" | "split";
  readonly theme: "light" | "dark";
  readonly isExpanded: boolean;
  readonly onToggleExpand: () => void;
  readonly isViewed: boolean;
  readonly onToggleViewed: () => void;
}): React.ReactElement {
  const { dir, name } = splitPath(file.file);
  const hasPatch = patch !== undefined && patch.length > 0;
  const isPending = !hasPatch && patchPending;
  const placeholder = placeholderMessage(file.status);

  const copyPath = (event: React.MouseEvent): void => {
    event.stopPropagation();
    void navigator.clipboard.writeText(file.file);
  };

  const onHeaderKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggleExpand();
    }
  };

  return (
    <div {...stylex.props(styles.root, isViewed && styles.rootViewed)}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        title={file.file}
        onClick={onToggleExpand}
        onKeyDown={onHeaderKeyDown}
        {...stylex.props(styles.header)}
      >
        <Icon
          icon={isExpanded ? IconChevronDownMedium : IconChevronRightMedium}
          size="sm"
          style={styles.chevron}
        />
        <span
          aria-label={file.status}
          {...stylex.props(
            styles.glyph,
            file.status === "added" && styles.glyphAdded,
            file.status === "deleted" && styles.glyphDeleted,
            file.status === "modified" && styles.glyphModified,
          )}
        >
          {fileStatusGlyph(file.status)}
        </span>
        <span {...stylex.props(styles.path)}>
          {dir.length > 0 ? <span {...stylex.props(styles.pathDir)}>{dir}</span> : null}
          <span {...stylex.props(styles.pathName)}>{name}</span>
        </span>
        <span {...stylex.props(styles.stats)}>
          {file.additions > 0 ? (
            <span {...stylex.props(styles.additions)}>+{file.additions}</span>
          ) : null}
          {file.deletions > 0 ? (
            <span {...stylex.props(styles.deletions)}>-{file.deletions}</span>
          ) : null}
        </span>
        <span {...stylex.props(styles.guard)} onClick={copyPath}>
          <IconButton size="sm" variant="quiet" aria-label="Copy path" onClick={copyPath}>
            <Icon icon={IconClipboard} size="sm" />
          </IconButton>
        </span>
        <span
          {...stylex.props(styles.guard)}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <Checkbox
            size="sm"
            aria-label="Viewed"
            checked={isViewed}
            onCheckedChange={onToggleViewed}
          />
        </span>
      </div>
      {isExpanded ? (
        <div data-honk-scrollport="" {...stylex.props(styles.body)}>
          {hasPatch ? (
            <PatchDiff patch={patch} options={buildDiffOptions(theme, diffStyle)} disableWorkerPool />
          ) : isPending ? (
            <div {...stylex.props(styles.loading)}>
              <Spinner size="sm" tone="muted" />
            </div>
          ) : (
            <div {...stylex.props(styles.placeholder)}>
              <Text as="p" size="sm" tone="muted" weight="regular">
                {placeholder.title}
              </Text>
              <Text as="p" size="xs" tone="faint">
                {placeholder.detail}
              </Text>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export { WorkbenchChangesCard };
