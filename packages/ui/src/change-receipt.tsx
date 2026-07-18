// Turn-scoped snapshot diffs only. Never reads the live working tree.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Button } from "./button";
import { Icon, type Glyph } from "./icon";
import {
  IconChevronDownMedium,
  IconCode,
  IconFileBend,
  IconFileJpg,
  IconFilePdf,
  IconFilePng,
  IconFileText,
  IconFileZip,
  IconJavascript,
  IconJson,
  IconMarkdown,
  IconTypescript,
} from "./icons";
import { applyStyle, type HonkStyle, type StyleProp } from "./style";
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
  readonly style?: StyleProp<HonkStyle>;
}

const DEFAULT_VISIBLE_COUNT = 5;
const MIN_VISIBLE_COUNT = 2;
const RECEIPT_RING_WIDTH = "1px";
const RECEIPT_RING = `inset 0 0 0 ${RECEIPT_RING_WIDTH} ${colorVars["--honk-color-border-base"]}`;
const FILE_TYPE_ICONS: Readonly<Record<string, Glyph>> = {
  "7z": IconFileZip,
  bash: IconCode,
  c: IconCode,
  cc: IconCode,
  cjs: IconJavascript,
  cpp: IconCode,
  cs: IconCode,
  css: IconCode,
  csv: IconFileText,
  dockerfile: IconCode,
  fish: IconCode,
  gitignore: IconCode,
  go: IconCode,
  gql: IconCode,
  graphql: IconCode,
  gz: IconFileZip,
  h: IconCode,
  hpp: IconCode,
  htm: IconCode,
  html: IconCode,
  java: IconCode,
  jpeg: IconFileJpg,
  jpg: IconFileJpg,
  js: IconJavascript,
  json: IconJson,
  jsonc: IconJson,
  jsx: IconJavascript,
  less: IconCode,
  log: IconFileText,
  makefile: IconCode,
  md: IconMarkdown,
  mdx: IconMarkdown,
  mjs: IconJavascript,
  pdf: IconFilePdf,
  php: IconCode,
  png: IconFilePng,
  py: IconCode,
  rar: IconFileZip,
  rb: IconCode,
  rs: IconCode,
  sass: IconCode,
  scss: IconCode,
  sh: IconCode,
  sql: IconCode,
  svelte: IconCode,
  svg: IconCode,
  swift: IconCode,
  tar: IconFileZip,
  tgz: IconFileZip,
  toml: IconCode,
  ts: IconTypescript,
  tsx: IconTypescript,
  txt: IconFileText,
  vue: IconCode,
  xml: IconCode,
  yaml: IconCode,
  yml: IconCode,
  zip: IconFileZip,
  zsh: IconCode,
};

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
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: "-1px",
  },
  stats: {
    marginInlineStart: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
  },
});

const forward = {
  title: { flexGrow: 1, minWidth: 0 },
  fileName: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  addition: { color: colorVars["--honk-color-diff-addition"] },
  deletion: { color: colorVars["--honk-color-diff-deletion"] },
  disclosure: { justifyContent: "flex-start" },
  disclosureExpanded: { transform: "rotate(180deg)" },
} satisfies Record<string, HonkStyle>;

function fileBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const [name = trimmed] = trimmed.split(/[\\/]/).slice(-1);
  return name.length > 0 ? name : path;
}

function fileIcon(path: string): Glyph {
  return FILE_TYPE_ICONS[fileBasename(path).toLowerCase().split(".").at(-1) ?? ""] ?? IconFileBend;
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
        <Text size="sm" family="mono" tone="inherit" tabularNums style={forward.addition}>
          +{additions}
        </Text>
      ) : null}
      {deletions > 0 ? (
        <Text size="sm" family="mono" tone="inherit" tabularNums style={forward.deletion}>
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
      <Icon icon={fileIcon(file.path)} size="sm" tone="muted" />
      <Text size="sm" tone="primary" truncate style={forward.fileName}>
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
  style,
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
    <section
      aria-label={title}
      data-change-receipt=""
      {...applyStyle(stylex.props(styles.root), style)}
    >
      <header {...stylex.props(styles.header)}>
        <Text size="sm" tone="muted" weight="regular" truncate style={forward.title}>
          {title}
        </Text>
        {onReview !== undefined ? (
          <Button
            variant="quiet"
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
            variant="quiet"
            size="sm"
            block
            aria-expanded={isExpanded}
            iconStart={
              <Icon
                icon={IconChevronDownMedium}
                size="xs"
                style={isExpanded ? forward.disclosureExpanded : undefined}
              />
            }
            style={forward.disclosure}
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
