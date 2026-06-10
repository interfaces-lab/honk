import { Fragment, type ReactNode } from "react";
import { Code, Pre } from "@multi/multikit/code";
import { Link } from "@multi/multikit/link";

type RichTextRecord = Record<string, unknown>;

export function ReadonlyRichTextMessage({
  fallbackText,
  richText,
}: {
  fallbackText: string;
  richText: unknown;
}) {
  const body = renderRichTextBody(richText);
  if (!body) {
    return fallbackText.length > 0 ? (
      <div className="max-w-full min-w-0 break-words wrap-anywhere">{fallbackText}</div>
    ) : null;
  }

  return (
    <div
      data-rich-text-message=""
      className="flex max-w-full min-w-0 flex-col gap-1 break-words wrap-anywhere"
    >
      {body}
    </div>
  );
}

export function hasRenderableRichText(richText: unknown): boolean {
  return renderRichTextBody(richText) !== null;
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
        <p key={key} className="m-0">
          {children || <br />}
        </p>
      );
    case "heading":
      return (
        <div key={key} className="m-0 font-semibold">
          {children}
        </div>
      );
    case "bulletList":
      return (
        <ul key={key} className="m-0 list-disc pl-5">
          {children}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={key} className="m-0 list-decimal pl-5">
          {children}
        </ol>
      );
    case "listItem":
      return <li key={key}>{children}</li>;
    case "blockquote":
      return (
        <blockquote key={key} className="m-0 border-l border-multi-stroke-secondary pl-2">
          {children}
        </blockquote>
      );
    case "codeBlock":
      return (
        <Pre
          key={key}
          className="m-0 max-h-none overflow-x-auto whitespace-pre-wrap border-0 bg-multi-bg-tertiary px-2 py-1 text-detail"
        >
          {plainTextFromTiptap(record)}
        </Pre>
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
      const text = tiptapAtomText(record);
      return text ? <span key={key}>{text}</span> : null;
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
        <p key={key} className="m-0">
          {children || <br />}
        </p>
      );
    case "heading":
      return (
        <div key={key} className="m-0 font-semibold">
          {children}
        </div>
      );
    case "list":
      return stringField(record, "listType") === "number" ? (
        <ol key={key} className="m-0 list-decimal pl-5">
          {children}
        </ol>
      ) : (
        <ul key={key} className="m-0 list-disc pl-5">
          {children}
        </ul>
      );
    case "listitem":
      return <li key={key}>{children}</li>;
    case "quote":
      return (
        <blockquote key={key} className="m-0 border-l border-multi-stroke-secondary pl-2">
          {children}
        </blockquote>
      );
    case "code":
      return (
        <Pre
          key={key}
          className="m-0 max-h-none overflow-x-auto whitespace-pre-wrap border-0 bg-multi-bg-tertiary px-2 py-1 text-detail"
        >
          {lexicalPlainText(record)}
        </Pre>
      );
    case "linebreak":
      return <br key={key} />;
    case "link": {
      const url = safeHref(stringField(record, "url"));
      return url ? (
        <Link key={key} href={url} target="_blank" rel="noreferrer" tone="inherit">
          {children}
        </Link>
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
      const text = lexicalAtomText(record);
      return text ? <span key={key}>{text}</span> : null;
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
        return <Code className="rounded-multi-control px-1 py-0 text-detail">{node}</Code>;
      case "link": {
        const href = safeHref(stringField(asRecord(record.attrs), "href"));
        return href ? (
          <Link href={href} target="_blank" rel="noreferrer" tone="inherit">
            {node}
          </Link>
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
  if ((format & 8) !== 0) node = <span className="underline underline-offset-2">{node}</span>;
  if ((format & 16) !== 0) {
    node = <Code className="rounded-multi-control px-1 py-0 text-detail">{node}</Code>;
  }
  return node;
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
