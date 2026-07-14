// The settled file-change receipt at the end of a turn. The caller supplies the turn-scoped
// snapshot diffs; this component never reads the live working tree, so an old transcript keeps
// describing the files that turn actually changed. Cursor's EndOfTurnSummary supplies the
// interaction model: a compact header, an initially bounded file list, and one explicit Review
// action. File rows become buttons only when the caller can open that exact file.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Button } from "./button";
import { Icon } from "./icon";
import { IconChevronDownMedium, IconFileBend } from "./icons";
import { Text } from "./text";
import { colorVars, controlVars, fontVars, radiusVars, spaceVars } from "./tokens.stylex";

type ChangeReceiptStatus = "added" | "deleted" | "modified";

interface ChangeReceiptFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly status?: ChangeReceiptStatus | undefined;
}

interface ChangeReceiptProps {
  readonly files: readonly ChangeReceiptFile[];
  readonly onReview?: (() => void) | undefined;
  readonly onFileClick?: ((file: ChangeReceiptFile) => void) | undefined;
  readonly initialVisibleCount?: number | undefined;
  readonly xstyle?: stylex.StyleXStyles;
}

// Cursor reserves five receipt rows by default: when the list is longer, four files plus the
// disclosure occupy those slots. It expands in place so the transcript remains the source of truth.
const DEFAULT_VISIBLE_COUNT = 5;
const MIN_VISIBLE_COUNT = 2;
const RECEIPT_RING_WIDTH = "1px";
const FOCUS_RING_WIDTH = "1px";
const FOCUS_RING_OFFSET_INSET = "-1px";
const RECEIPT_RING = `inset 0 0 0 ${RECEIPT_RING_WIDTH} ${colorVars["--honk-color-border-base"]}`;

const styles = stylex.create({
  root: {
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
    overflow: "hidden",
    borderRadius: radiusVars["--honk-radius-panel"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    boxShadow: RECEIPT_RING,
    fontFamily: fontVars["--honk-font-family-ui"],
  },
  header: {
    minHeight: controlVars["--honk-control-h-md"],
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingBlockStart: controlVars["--honk-control-gap"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
  },
  title: {
    flexGrow: 1,
    minWidth: 0,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    paddingInline: controlVars["--honk-control-gap"],
    paddingBlockEnd: controlVars["--honk-control-gap"],
  },
  row: {
    boxSizing: "border-box",
    minHeight: controlVars["--honk-control-h-md"],
    width: "100%",
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingInline: controlVars["--honk-control-pad-sm"],
    borderRadius: radiusVars["--honk-radius-control"],
    color: colorVars["--honk-color-text-primary"],
  },
  rowInteractive: {
    appearance: "none",
    borderWidth: 0,
    backgroundColor: {
      default: "transparent",
      ":hover": {
        "@media (hover: hover)": colorVars["--honk-color-state-hover"],
      },
    },
    fontFamily: "inherit",
    textAlign: "start",
    cursor: "pointer",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: FOCUS_RING_WIDTH,
    outlineOffset: FOCUS_RING_OFFSET_INSET,
  },
  fileName: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  stats: {
    marginInlineStart: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
  },
  addition: {
    color: colorVars["--honk-color-diff-addition"],
  },
  deletion: {
    color: colorVars["--honk-color-diff-deletion"],
  },
  disclosure: {
    justifyContent: "flex-start",
  },
  disclosureExpanded: {
    transform: "rotate(180deg)",
  },
});

function fileBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const [name = trimmed] = trimmed.split(/[\\/]/).slice(-1);
  return name.length > 0 ? name : path;
}

function ChangeStats({
  additions,
  deletions,
}: Pick<ChangeReceiptFile, "additions" | "deletions">): React.ReactElement | null {
  if (additions === 0 && deletions === 0) {
    return null;
  }
  return (
    <span {...stylex.props(styles.stats)}>
      {additions > 0 ? (
        <Text size="sm" family="mono" tone="inherit" tabularNums xstyle={styles.addition}>
          +{additions}
        </Text>
      ) : null}
      {deletions > 0 ? (
        <Text size="sm" family="mono" tone="inherit" tabularNums xstyle={styles.deletion}>
          −{deletions}
        </Text>
      ) : null}
    </span>
  );
}

function ChangeRow({
  file,
  onFileClick,
}: {
  readonly file: ChangeReceiptFile;
  readonly onFileClick?: ((file: ChangeReceiptFile) => void) | undefined;
}): React.ReactElement {
  const content = (
    <>
      <Icon icon={IconFileBend} size="sm" tone="muted" />
      <Text size="sm" tone="primary" truncate xstyle={styles.fileName}>
        {fileBasename(file.path)}
      </Text>
      <ChangeStats additions={file.additions} deletions={file.deletions} />
    </>
  );

  if (onFileClick === undefined) {
    return (
      <div
        title={file.path}
        data-change-status={file.status ?? "modified"}
        {...stylex.props(styles.row)}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      title={file.path}
      aria-label={`Open ${file.path}, ${file.status ?? "modified"}`}
      data-change-status={file.status ?? "modified"}
      onClick={() => {
        onFileClick(file);
      }}
      {...stylex.props(styles.row, styles.rowInteractive)}
    >
      {content}
    </button>
  );
}

function ChangeReceipt({
  files,
  onReview,
  onFileClick,
  initialVisibleCount = DEFAULT_VISIBLE_COUNT,
  xstyle,
}: ChangeReceiptProps): React.ReactElement | null {
  const [isExpanded, setExpanded] = React.useState(false);
  if (files.length === 0) {
    return null;
  }

  const boundedVisibleCount = Math.max(MIN_VISIBLE_COUNT, initialVisibleCount);
  const isCollapsible = files.length > boundedVisibleCount;
  const collapsedFileCount = boundedVisibleCount - 1;
  const visibleFiles = isCollapsible && !isExpanded ? files.slice(0, collapsedFileCount) : files;
  const hiddenCount = files.length - visibleFiles.length;
  const title = `${String(files.length)} ${files.length === 1 ? "File" : "Files"} Changed`;

  return (
    <section aria-label={title} data-change-receipt="" {...stylex.props(styles.root, xstyle)}>
      <header {...stylex.props(styles.header)}>
        <Text size="sm" tone="muted" weight="medium" truncate xstyle={styles.title}>
          {title}
        </Text>
        {onReview !== undefined ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Review ${String(files.length)} changed ${files.length === 1 ? "file" : "files"}`}
            onClick={onReview}
          >
            Review
          </Button>
        ) : null}
      </header>
      <div {...stylex.props(styles.list)}>
        {visibleFiles.map((file) => (
          <ChangeRow key={file.path} file={file} onFileClick={onFileClick} />
        ))}
        {isCollapsible ? (
          <Button
            variant="ghost"
            size="sm"
            block
            aria-expanded={isExpanded}
            iconStart={
              <Icon
                icon={IconChevronDownMedium}
                size="xs"
                xstyle={isExpanded ? styles.disclosureExpanded : undefined}
              />
            }
            xstyle={styles.disclosure}
            onClick={() => {
              setExpanded((current) => !current);
            }}
          >
            {isExpanded ? "Show less" : `Show ${String(hiddenCount)} more`}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export { ChangeReceipt };
export type { ChangeReceiptFile, ChangeReceiptProps, ChangeReceiptStatus };
