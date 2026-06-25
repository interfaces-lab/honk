import * as stylex from "@stylexjs/stylex";
import {
  IconBuildingBlocks,
  IconChainLink2,
  IconCode,
  type CentralIconBaseProps,
} from "central-icons";
import { Fragment, type ComponentType, type ReactNode } from "react";

import {
  basenameOfPath,
  getVscodeIconUrlForEntry,
  inferEntryKindFromPath,
} from "../shared/vscode-entry-icons";

type RichTextRecord = Record<string, unknown>;
type AtomChipKind = "command" | "inline-token" | "link" | "mention" | "skill";

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--honk-spacing-1)",
    maxWidth: "100%",
    minWidth: 0,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  fallback: {
    maxWidth: "100%",
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  paragraph: {
    margin: 0,
  },
  heading: {
    fontWeight: 600,
    margin: 0,
  },
  unorderedList: {
    listStyleType: "disc",
    margin: 0,
    paddingInlineStart: "1.25rem",
  },
  orderedList: {
    listStyleType: "decimal",
    margin: 0,
    paddingInlineStart: "1.25rem",
  },
  blockquote: {
    borderLeftColor: "var(--honk-stroke-secondary)",
    borderLeftStyle: "solid",
    borderLeftWidth: 1,
    margin: 0,
    paddingInlineStart: "var(--honk-spacing-2)",
  },
  pre: {
    backgroundColor: "var(--honk-bg-tertiary)",
    borderWidth: 0,
    fontFamily: "var(--honk-font-mono)",
    fontSize: "var(--honk-text-detail)",
    lineHeight: "var(--honk-leading-detail)",
    margin: 0,
    maxHeight: "none",
    overflowX: "auto",
    paddingBlock: "var(--honk-spacing-1)",
    paddingInline: "var(--honk-spacing-2)",
    whiteSpace: "pre-wrap",
  },
  code: {
    backgroundColor: "var(--honk-bg-tertiary)",
    borderRadius: "var(--honk-radius-control)",
    fontFamily: "var(--honk-font-mono)",
    fontSize: "var(--honk-text-detail)",
    paddingBlock: 0,
    paddingInline: "var(--honk-spacing-1)",
  },
  underline: {
    textDecorationLine: "underline",
    textUnderlineOffset: "2px",
  },
  link: {
    backgroundColor: "transparent",
    color: "var(--honk-markdown-link-foreground, var(--primary))",
    cursor: "pointer",
    textDecorationLine: {
      default: "none",
      ":hover": "underline",
    },
    textUnderlineOffset: "2px",
  },
  chip: {
    alignItems: "center",
    borderRadius: "6px",
    boxSizing: "border-box",
    display: "inline-flex",
    fontFamily: "var(--honk-font-ui)",
    fontSize: "var(--honk-composer-chip-font-size)",
    fontWeight: 400,
    gap: "4px",
    lineHeight: "var(--honk-composer-chip-line-height)",
    maxWidth: "var(--honk-composer-chip-max-width)",
    minWidth: 0,
    paddingBlock: "1px",
    paddingLeft: "4px",
    paddingRight: "4px",
    textDecoration: "none",
    userSelect: "none",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
  },
  chipMention: {
    backgroundColor: "var(--honk-composer-mention-background)",
    color: "var(--honk-composer-mention-text)",
  },
  chipCommand: {
    backgroundColor: "var(--honk-composer-command-background)",
    color: "var(--honk-composer-command-text)",
  },
  chipLink: {
    backgroundColor: "color-mix(in srgb, var(--primary) 10%, transparent)",
    color: "var(--honk-markdown-link-foreground, var(--primary))",
  },
  chipLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  chipDetail: {
    color: "var(--honk-composer-mention-line-range-text)",
    flexShrink: 0,
    fontSize: "var(--honk-composer-chip-line-range-font-size)",
  },
  chipIcon: {
    alignItems: "center",
    display: "inline-flex",
    flexShrink: 0,
    height: "var(--honk-composer-chip-icon-size)",
    justifyContent: "center",
    width: "var(--honk-composer-chip-icon-size)",
  },
  chipFileIcon: {
    display: "block",
    flexShrink: 0,
    height: "var(--honk-composer-chip-icon-size)",
    opacity: 0.9,
    width: "var(--honk-composer-chip-icon-size)",
  },
});

export function UserRichTextMessage({
  fallbackText,
  richText,
}: {
  fallbackText: string;
  richText: unknown;
}) {
  const body = renderRichTextBody(richText);
  if (!body) {
    return fallbackText.length > 0 ? (
      <div {...stylex.props(styles.fallback)}>{fallbackText}</div>
    ) : null;
  }

  return (
    <div {...stylex.props(styles.root)} data-rich-text-message="">
      {body}
    </div>
  );
}

export function hasRenderableRichText(richText: unknown): boolean {
  return richTextNeedsStructuredRendering(richText) && renderRichTextBody(richText) !== null;
}

function richTextNeedsStructuredRendering(richText: unknown): boolean {
  const doc = asRecord(richText);
  if (!doc) {
    return false;
  }
  if (doc.type === "doc") {
    return asArray(doc.content).some(tiptapNodeNeedsStructuredRendering);
  }
  const root = asRecord(doc.root);
  if (root) {
    return asArray(root.children).some(lexicalNodeNeedsStructuredRendering);
  }
  return false;
}

function tiptapNodeNeedsStructuredRendering(node: unknown): boolean {
  const record = asRecord(node);
  if (!record) {
    return false;
  }

  switch (record.type) {
    case "paragraph":
      return asArray(record.content).some(tiptapNodeNeedsStructuredRendering);
    case "text":
      return asArray(record.marks).length > 0;
    case "hardBreak":
      return false;
    case "mentionNode":
    case "commandNode":
    case "skillNode":
    case "inlineTokenNode":
      return true;
    case "heading":
    case "bulletList":
    case "orderedList":
    case "blockquote":
    case "codeBlock":
      return true;
    default:
      return asArray(record.content).some(tiptapNodeNeedsStructuredRendering);
  }
}

function lexicalNodeNeedsStructuredRendering(node: unknown): boolean {
  const record = asRecord(node);
  if (!record) {
    return false;
  }

  switch (record.type) {
    case "root":
    case "paragraph":
      return asArray(record.children).some(lexicalNodeNeedsStructuredRendering);
    case "text":
      return (numberField(record, "format") ?? 0) !== 0 || stringField(record, "style") !== null;
    case "linebreak":
      return false;
    case "mentionNode":
    case "commandNode":
    case "skillNode":
    case "inlineTokenNode":
      return true;
    case "heading":
    case "list":
    case "quote":
    case "code":
    case "link":
      return true;
    default:
      return asArray(record.children).some(lexicalNodeNeedsStructuredRendering);
  }
}

function renderRichTextBody(richText: unknown): ReactNode | null {
  const doc = asRecord(richText);
  if (!doc) {
    return null;
  }
  if (doc.type === "doc") {
    return nonEmptyNodes(
      trimEmptyBoundaryNodes(asArray(doc.content), isEmptyTiptapNode).map(renderTiptapNode),
    );
  }
  const root = asRecord(doc.root);
  if (root) {
    return nonEmptyNodes(
      trimEmptyBoundaryNodes(asArray(root.children), isEmptyLexicalNode).map(renderLexicalNode),
    );
  }
  return null;
}

function renderTiptapNode(node: unknown, index: number): ReactNode {
  const record = asRecord(node);
  if (!record) {
    return null;
  }

  const children = nonEmptyNodes(asArray(record.content).map(renderTiptapNode));
  const key = `tiptap:${index}`;
  switch (record.type) {
    case "paragraph":
      return (
        <p key={key} {...stylex.props(styles.paragraph)}>
          {children || <br />}
        </p>
      );
    case "heading":
      return (
        <div key={key} {...stylex.props(styles.heading)}>
          {children}
        </div>
      );
    case "bulletList":
      return (
        <ul key={key} {...stylex.props(styles.unorderedList)}>
          {children}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={key} {...stylex.props(styles.orderedList)}>
          {children}
        </ol>
      );
    case "listItem":
      return <li key={key}>{children}</li>;
    case "blockquote":
      return (
        <blockquote key={key} {...stylex.props(styles.blockquote)}>
          {children}
        </blockquote>
      );
    case "codeBlock":
      return (
        <pre key={key} {...stylex.props(styles.pre)}>
          {plainTextFromTiptap(record)}
        </pre>
      );
    case "hardBreak":
      return <br key={key} />;
    case "text": {
      const text = stringField(record, "text");
      return text ? (
        <Fragment key={key}>{applyTiptapMarks(text, asArray(record.marks))}</Fragment>
      ) : null;
    }
    case "mentionNode":
    case "commandNode":
    case "skillNode":
    case "inlineTokenNode": {
      return renderTiptapAtom(record, key);
    }
    default: {
      const text = stringField(record, "text");
      if (text) {
        return <span key={key}>{text}</span>;
      }
      return children ? <Fragment key={key}>{children}</Fragment> : null;
    }
  }
}

function renderLexicalNode(node: unknown, index: number): ReactNode {
  const record = asRecord(node);
  if (!record) {
    return null;
  }

  const children = nonEmptyNodes(asArray(record.children).map(renderLexicalNode));
  const key = `lexical:${index}`;
  switch (record.type) {
    case "paragraph":
      return (
        <p key={key} {...stylex.props(styles.paragraph)}>
          {children || <br />}
        </p>
      );
    case "heading":
      return (
        <div key={key} {...stylex.props(styles.heading)}>
          {children}
        </div>
      );
    case "list":
      return stringField(record, "listType") === "number" ? (
        <ol key={key} {...stylex.props(styles.orderedList)}>
          {children}
        </ol>
      ) : (
        <ul key={key} {...stylex.props(styles.unorderedList)}>
          {children}
        </ul>
      );
    case "listitem":
      return <li key={key}>{children}</li>;
    case "quote":
      return (
        <blockquote key={key} {...stylex.props(styles.blockquote)}>
          {children}
        </blockquote>
      );
    case "code":
      return (
        <pre key={key} {...stylex.props(styles.pre)}>
          {lexicalPlainText(record)}
        </pre>
      );
    case "linebreak":
      return <br key={key} />;
    case "link": {
      const url = safeHref(stringField(record, "url"));
      return url ? (
        <a key={key} {...stylex.props(styles.link)} href={url} target="_blank" rel="noreferrer">
          {children}
        </a>
      ) : (
        <Fragment key={key}>{children}</Fragment>
      );
    }
    case "text": {
      const text = stringField(record, "text");
      return text ? (
        <Fragment key={key}>
          {applyLexicalFormat(text, numberField(record, "format") ?? 0)}
        </Fragment>
      ) : null;
    }
    case "mentionNode":
    case "commandNode":
    case "skillNode":
    case "inlineTokenNode": {
      return renderLexicalAtom(record, key);
    }
    default: {
      const text = stringField(record, "text");
      if (text) {
        return <span key={key}>{text}</span>;
      }
      return children ? <Fragment key={key}>{children}</Fragment> : null;
    }
  }
}

function applyTiptapMarks(text: string, marks: unknown[]): ReactNode {
  return marks.reduce<ReactNode>((node, mark) => {
    const record = asRecord(mark);
    switch (record?.type) {
      case "bold":
        return <strong>{node}</strong>;
      case "italic":
        return <em>{node}</em>;
      case "strike":
        return <s>{node}</s>;
      case "code":
        return <code {...stylex.props(styles.code)}>{node}</code>;
      case "link": {
        const href = safeHref(stringField(asRecord(record.attrs), "href"));
        return href ? (
          <a {...stylex.props(styles.link)} href={href} target="_blank" rel="noreferrer">
            {node}
          </a>
        ) : (
          node
        );
      }
      default:
        return node;
    }
  }, text);
}

function applyLexicalFormat(text: string, format: number): ReactNode {
  let node: ReactNode = text;
  if ((format & 1) !== 0) node = <strong>{node}</strong>;
  if ((format & 2) !== 0) node = <em>{node}</em>;
  if ((format & 4) !== 0) node = <s>{node}</s>;
  if ((format & 8) !== 0) node = <span {...stylex.props(styles.underline)}>{node}</span>;
  if ((format & 16) !== 0) {
    node = <code {...stylex.props(styles.code)}>{node}</code>;
  }
  return node;
}

function renderTiptapAtom(record: RichTextRecord, key: string): ReactNode {
  const attrs = asRecord(record.attrs);
  switch (record.type) {
    case "mentionNode": {
      const href = safeHref(
        stringField(attrs, "href") ?? stringField(attrs, "url") ?? stringField(attrs, "path"),
      );
      if (href) {
        return (
          <AtomChip
            key={key}
            dataType="mentionNode"
            href={href}
            icon={IconChainLink2}
            kind="link"
            label={stringField(attrs, "label") ?? href}
            title={href}
          />
        );
      }

      const path = stringField(attrs, "path");
      return (
        <AtomChip
          key={key}
          dataType="mentionNode"
          detail={lineRangeFromRecord(attrs)}
          kind="mention"
          label={stringField(attrs, "label") ?? (path ? basenameOfPath(path) : "@")}
          path={path}
          title={path}
        />
      );
    }
    case "commandNode": {
      const name = stringField(attrs, "name");
      return (
        <AtomChip
          key={key}
          dataType="commandNode"
          kind="command"
          label={name ? `/${name}` : "/"}
          title={stringField(attrs, "content")}
        />
      );
    }
    case "skillNode": {
      const name = stringField(attrs, "skillName") ?? stringField(attrs, "name");
      return (
        <AtomChip
          key={key}
          dataType="skillNode"
          icon={IconBuildingBlocks}
          kind="skill"
          label={stringField(attrs, "label") ?? (name ? `$${name}` : "$")}
          title={stringField(attrs, "description") ?? stringField(attrs, "path")}
        />
      );
    }
    case "inlineTokenNode":
      return (
        <AtomChip
          key={key}
          dataType="inlineTokenNode"
          icon={IconCode}
          kind="inline-token"
          label={stringField(attrs, "label") ?? stringField(attrs, "sourceUri") ?? "token"}
          title={stringField(attrs, "sourceUri") ?? stringField(attrs, "markdown")}
        />
      );
    default:
      return null;
  }
}

function renderLexicalAtom(record: RichTextRecord, key: string): ReactNode {
  switch (record.type) {
    case "mentionNode": {
      const href = safeHref(
        stringField(record, "href") ?? stringField(record, "url") ?? stringField(record, "path"),
      );
      if (href) {
        return (
          <AtomChip
            key={key}
            dataType="mentionNode"
            href={href}
            icon={IconChainLink2}
            kind="link"
            label={stringField(record, "label") ?? href}
            title={href}
          />
        );
      }

      const path = stringField(record, "path");
      return (
        <AtomChip
          key={key}
          dataType="mentionNode"
          detail={lineRangeFromRecord(record)}
          kind="mention"
          label={stringField(record, "label") ?? (path ? basenameOfPath(path) : "@")}
          path={path}
          title={path}
        />
      );
    }
    case "commandNode": {
      const name = stringField(record, "name");
      return (
        <AtomChip
          key={key}
          dataType="commandNode"
          kind="command"
          label={name ? `/${name}` : "/"}
          title={stringField(record, "content")}
        />
      );
    }
    case "skillNode": {
      const name = stringField(record, "name");
      return (
        <AtomChip
          key={key}
          dataType="skillNode"
          icon={IconBuildingBlocks}
          kind="skill"
          label={stringField(record, "label") ?? (name ? `$${name}` : "$")}
          title={stringField(record, "description") ?? stringField(record, "path")}
        />
      );
    }
    case "inlineTokenNode":
      return (
        <AtomChip
          key={key}
          dataType="inlineTokenNode"
          icon={IconCode}
          kind="inline-token"
          label={stringField(record, "label") ?? stringField(record, "sourceUri") ?? "token"}
          title={stringField(record, "sourceUri") ?? stringField(record, "markdown")}
        />
      );
    default:
      return null;
  }
}

function AtomChip({
  dataType,
  detail,
  href,
  icon: Icon,
  kind,
  label,
  path,
  title,
}: {
  dataType: string;
  detail?: string | null;
  href?: string | null;
  icon?: ComponentType<CentralIconBaseProps> | null;
  kind: AtomChipKind;
  label: string;
  path?: string | null;
  title?: string | null;
}) {
  const chipProps = {
    ...stylex.props(
      styles.chip,
      kind === "command" || kind === "skill" ? styles.chipCommand : null,
      kind === "link" ? styles.chipLink : null,
      kind !== "command" && kind !== "skill" && kind !== "link" ? styles.chipMention : null,
    ),
    contentEditable: false,
    "data-rich-text-atom-chip": kind,
    "data-type": dataType,
    spellCheck: false,
    title: title ?? undefined,
  };
  const content = (
    <>
      <AtomChipIcon Icon={Icon} path={path} />
      <span {...stylex.props(styles.chipLabel)}>{label}</span>
      {detail ? <span {...stylex.props(styles.chipDetail)}>{detail}</span> : null}
    </>
  );

  return href ? (
    <a {...chipProps} href={href} rel="noreferrer" target="_blank">
      {content}
    </a>
  ) : (
    <span {...chipProps}>{content}</span>
  );
}

function AtomChipIcon({
  Icon,
  path,
}: {
  Icon: ComponentType<CentralIconBaseProps> | null | undefined;
  path: string | null | undefined;
}) {
  if (path) {
    return (
      <img
        {...stylex.props(styles.chipFileIcon)}
        alt=""
        aria-hidden="true"
        loading="lazy"
        src={getVscodeIconUrlForEntry(path, inferEntryKindFromPath(path), resolvedTheme())}
      />
    );
  }

  if (!Icon) {
    return null;
  }

  return (
    <span {...stylex.props(styles.chipIcon)} aria-hidden="true">
      <Icon ariaHidden size="var(--honk-composer-chip-icon-size)" />
    </span>
  );
}

function lineRangeFromRecord(record: RichTextRecord | null): string | null {
  if (!record) {
    return null;
  }
  const lineStart = numberField(record, "lineStart");
  const lineEnd = numberField(record, "lineEnd");
  if (lineStart === null || lineEnd === null) {
    return null;
  }
  return lineStart === lineEnd ? `:${lineStart}` : `:${lineStart}-${lineEnd}`;
}

function tiptapAtomText(record: RichTextRecord): string | null {
  const attrs = asRecord(record.attrs);
  switch (record.type) {
    case "mentionNode": {
      const path = stringField(attrs, "path");
      return path ? `@${path}` : "@";
    }
    case "commandNode": {
      const name = stringField(attrs, "name");
      return name ? `/${name}` : "/";
    }
    case "skillNode": {
      const name = stringField(attrs, "skillName");
      return name ? `$${name}` : "$";
    }
    case "inlineTokenNode":
      return stringField(attrs, "markdown");
    default:
      return null;
  }
}

function lexicalAtomText(record: RichTextRecord): string | null {
  const text = stringField(record, "text");
  if (text) {
    return text;
  }
  switch (record.type) {
    case "mentionNode": {
      const path = stringField(record, "path");
      return path ? `@${path}` : "@";
    }
    case "commandNode": {
      const name = stringField(record, "name");
      return name ? `/${name}` : "/";
    }
    case "skillNode": {
      const name = stringField(record, "name");
      return name ? `$${name}` : "$";
    }
    case "inlineTokenNode":
      return stringField(record, "markdown");
    default:
      return null;
  }
}

function plainTextFromTiptap(record: RichTextRecord): string {
  return asArray(record.content).map(tiptapNodeText).join("");
}

function tiptapNodeText(node: unknown): string {
  const record = asRecord(node);
  if (!record) {
    return "";
  }
  const text = stringField(record, "text") ?? tiptapAtomText(record);
  if (text) {
    return text;
  }
  if (record.type === "hardBreak") {
    return "\n";
  }
  return asArray(record.content).map(tiptapNodeText).join("");
}

function lexicalPlainText(record: RichTextRecord): string {
  return asArray(record.children).map(lexicalNodeText).join("");
}

function lexicalNodeText(node: unknown): string {
  const record = asRecord(node);
  if (!record) {
    return "";
  }
  const text = stringField(record, "text") ?? lexicalAtomText(record);
  if (text) {
    return text;
  }
  if (record.type === "linebreak") {
    return "\n";
  }
  return asArray(record.children).map(lexicalNodeText).join("");
}

function trimEmptyBoundaryNodes(
  nodes: unknown[],
  isEmptyNode: (node: unknown) => boolean,
): unknown[] {
  let start = 0;
  let end = nodes.length;

  while (start < end && isEmptyNode(nodes[start])) {
    start += 1;
  }
  while (end > start && isEmptyNode(nodes[end - 1])) {
    end -= 1;
  }

  return nodes.slice(start, end);
}

function isEmptyTiptapNode(node: unknown): boolean {
  const record = asRecord(node);
  if (!record) {
    return true;
  }
  if (record.type === "paragraph") {
    return tiptapNodeText(record).trim().length === 0;
  }
  return false;
}

function isEmptyLexicalNode(node: unknown): boolean {
  const record = asRecord(node);
  if (!record) {
    return true;
  }
  if (record.type === "paragraph") {
    return lexicalNodeText(record).trim().length === 0;
  }
  return false;
}

function nonEmptyNodes(nodes: ReactNode[]): ReactNode | null {
  const visible = nodes.filter((node) => node !== null && node !== undefined && node !== false);
  return visible.length > 0 ? visible : null;
}

function safeHref(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function resolvedTheme(): "dark" | "light" {
  if (typeof document === "undefined") {
    return "dark";
  }
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function asRecord(value: unknown): RichTextRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RichTextRecord)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringField(record: RichTextRecord | null, field: string): string | null {
  const value = record?.[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(record: RichTextRecord, field: string): number | null {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
