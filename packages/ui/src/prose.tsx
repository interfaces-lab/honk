// Long-form reading primitives for assistant output. The family keeps the text column narrow and
// rhythmic while code, tables, and media can use the full conversation lane. Markdown parsing is
// deliberately outside this package: @honk/ui owns the rendered anatomy, and consumers map their
// parser's semantic leaves onto this compound.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { proseCodeBlockStyle } from "./prose-code-block";
import { colorVars, fontVars, proseVars, radiusVars, spaceVars } from "./tokens.stylex";

// A blockquote's rule is structural hairline geometry, shared with separators and table rows but
// private to this component's markup, so it stays a named intrinsic rather than a theme value.
const PROSE_HAIRLINE = "1px";
// Making Software uses a 2px inline-code inset and a 2px underline offset at the same 14px prose
// size. These are glyph-adjacent anatomy, not layout vocabulary, so they stay private intrinsics.
const INLINE_CODE_INSET = "2px";
const LINK_UNDERLINE_OFFSET = "2px";

const styles = stylex.create({
  root: {
    width: "100%",
    minWidth: 0,
    color: colorVars["--honk-color-fg"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: proseVars["--honk-prose-size"],
    lineHeight: proseVars["--honk-prose-leading"],
    fontOpticalSizing: "auto",
    overflowWrap: "anywhere",
  },
  measure: {
    width: "100%",
    maxWidth: proseVars["--honk-prose-measure"],
  },
  flow: {
    marginBlockStart: 0,
    marginBlockEnd: {
      default: proseVars["--honk-prose-flow-gap"],
      ":last-child": 0,
    },
  },
  paragraph: {
    textWrap: "pretty",
  },
  heading: {
    marginBlockStart: {
      default: proseVars["--honk-prose-section-gap"],
      ":first-child": 0,
    },
    marginBlockEnd: proseVars["--honk-prose-flow-gap"],
    color: colorVars["--honk-color-fg"],
    fontWeight: fontVars["--honk-font-weight-semibold"],
    textWrap: "balance",
    scrollMarginBlockStart: proseVars["--honk-prose-section-gap"],
  },
  headingLarge: {
    fontSize: fontVars["--honk-text-heading"],
    lineHeight: proseVars["--honk-prose-leading"],
  },
  headingSmall: {
    fontSize: proseVars["--honk-prose-size"],
    lineHeight: proseVars["--honk-prose-leading"],
  },
  list: {
    paddingInlineStart: spaceVars["--honk-space-panel-pad"],
  },
  unordered: {
    listStyleType: "disc",
  },
  ordered: {
    listStyleType: "decimal",
  },
  listItem: {
    marginBlockEnd: {
      default: proseVars["--honk-prose-flow-gap"],
      ":last-child": 0,
    },
  },
  link: {
    color: {
      default: colorVars["--honk-color-accent"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-fg"] },
    },
    textDecorationLine: "underline",
    textDecorationThickness: PROSE_HAIRLINE,
    textUnderlineOffset: LINK_UNDERLINE_OFFSET,
  },
  strong: {
    color: colorVars["--honk-color-fg"],
    fontWeight: fontVars["--honk-font-weight-semibold"],
  },
  inlineCode: {
    paddingBlock: INLINE_CODE_INSET,
    paddingInline: INLINE_CODE_INSET,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    color: colorVars["--honk-color-fg"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-text-detail"],
    lineHeight: fontVars["--honk-leading-detail"],
  },
  blockquote: {
    marginInline: 0,
    paddingInlineStart: spaceVars["--honk-space-panel-pad"],
    borderInlineStartWidth: PROSE_HAIRLINE,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: colorVars["--honk-color-border-strong"],
    color: colorVars["--honk-color-fg-secondary"],
    fontStyle: "italic",
  },
  rule: {
    height: PROSE_HAIRLINE,
    marginBlock: proseVars["--honk-prose-section-gap"],
    borderWidth: 0,
    backgroundColor: colorVars["--honk-color-border-muted"],
  },
  tableWrap: {
    width: "100%",
    maxWidth: "100%",
    marginBlockEnd: proseVars["--honk-prose-flow-gap"],
    overflowX: "auto",
    overscrollBehaviorX: "contain",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontVariantNumeric: "tabular-nums",
  },
  tableCell: {
    paddingBlock: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
    borderBlockEndWidth: PROSE_HAIRLINE,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: colorVars["--honk-color-border-muted"],
    textAlign: "start",
    verticalAlign: "top",
  },
  tableHead: {
    color: colorVars["--honk-color-fg"],
    fontWeight: fontVars["--honk-font-weight-semibold"],
  },
  image: {
    display: "block",
    maxWidth: "100%",
    height: "auto",
    marginBlockEnd: proseVars["--honk-prose-flow-gap"],
    borderRadius: radiusVars["--honk-radius-control"],
  },
});

type ProseElementProps<Tag extends keyof React.JSX.IntrinsicElements> = Omit<
  React.ComponentPropsWithoutRef<Tag>,
  "className" | "style"
> & {
  xstyle?: stylex.StyleXStyles;
};

type ProseRootProps = ProseElementProps<"div">;
type ProseParagraphProps = ProseElementProps<"p">;
type ProseListItemProps = ProseElementProps<"li">;
type ProseLinkProps = ProseElementProps<"a">;
type ProseStrongProps = ProseElementProps<"strong">;
type ProseInlineCodeProps = ProseElementProps<"code">;
type ProseCodeBlockProps = ProseElementProps<"pre">;
type ProseBlockquoteProps = ProseElementProps<"blockquote">;
type ProseRuleProps = ProseElementProps<"hr">;
type ProseTableProps = ProseElementProps<"table">;
type ProseTableHeaderProps = ProseElementProps<"th">;
type ProseTableDataProps = ProseElementProps<"td">;
type ProseImageProps = ProseElementProps<"img">;
type ProseHeadingLevel = 1 | 2 | 3;

interface ProseHeadingProps extends ProseElementProps<"h2"> {
  level?: ProseHeadingLevel;
}

interface ProseListProps extends ProseElementProps<"ul"> {
  ordered?: boolean;
}

function ProseRoot({ xstyle, ...props }: ProseRootProps): React.ReactElement {
  return <div data-slot="prose" {...stylex.props(styles.root, xstyle)} {...props} />;
}

function Paragraph({ xstyle, ...props }: ProseParagraphProps): React.ReactElement {
  return (
    <p
      data-slot="prose-paragraph"
      {...stylex.props(styles.measure, styles.flow, styles.paragraph, xstyle)}
      {...props}
    />
  );
}

const headingElements = { 1: "h1", 2: "h2", 3: "h3" } as const;

function Heading({ level = 2, xstyle, ...props }: ProseHeadingProps): React.ReactElement {
  const Component = headingElements[level];
  return (
    <Component
      data-slot="prose-heading"
      {...stylex.props(
        styles.measure,
        styles.heading,
        level === 1 ? styles.headingLarge : styles.headingSmall,
        xstyle,
      )}
      {...props}
    />
  );
}

function List({ ordered = false, xstyle, ...props }: ProseListProps): React.ReactElement {
  const Component = ordered ? "ol" : "ul";
  return (
    <Component
      data-slot="prose-list"
      {...stylex.props(
        styles.measure,
        styles.flow,
        styles.list,
        ordered ? styles.ordered : styles.unordered,
        xstyle,
      )}
      {...props}
    />
  );
}

function ListItem({ xstyle, ...props }: ProseListItemProps): React.ReactElement {
  return <li {...stylex.props(styles.listItem, xstyle)} {...props} />;
}

function Link({ xstyle, ...props }: ProseLinkProps): React.ReactElement {
  return <a {...stylex.props(styles.link, xstyle)} {...props} />;
}

function Strong({ xstyle, ...props }: ProseStrongProps): React.ReactElement {
  return <strong {...stylex.props(styles.strong, xstyle)} {...props} />;
}

function InlineCode({ xstyle, ...props }: ProseInlineCodeProps): React.ReactElement {
  return <code {...stylex.props(styles.inlineCode, xstyle)} {...props} />;
}

function CodeBlock({ xstyle, ...props }: ProseCodeBlockProps): React.ReactElement {
  return <pre {...stylex.props(proseCodeBlockStyle, xstyle)} {...props} />;
}

function Blockquote({ xstyle, ...props }: ProseBlockquoteProps): React.ReactElement {
  return (
    <blockquote
      {...stylex.props(styles.measure, styles.flow, styles.blockquote, xstyle)}
      {...props}
    />
  );
}

function Rule({ xstyle, ...props }: ProseRuleProps): React.ReactElement {
  return <hr {...stylex.props(styles.measure, styles.rule, xstyle)} {...props} />;
}

function Table({ xstyle, ...props }: ProseTableProps): React.ReactElement {
  return (
    <div {...stylex.props(styles.tableWrap)}>
      <table {...stylex.props(styles.table, xstyle)} {...props} />
    </div>
  );
}

function TableHeader({ xstyle, ...props }: ProseTableHeaderProps): React.ReactElement {
  return <th {...stylex.props(styles.tableCell, styles.tableHead, xstyle)} {...props} />;
}

function TableData({ xstyle, ...props }: ProseTableDataProps): React.ReactElement {
  return <td {...stylex.props(styles.tableCell, xstyle)} {...props} />;
}

function Image({ xstyle, ...props }: ProseImageProps): React.ReactElement {
  return <img {...stylex.props(styles.image, xstyle)} {...props} />;
}

const Prose = Object.assign(ProseRoot, {
  Paragraph,
  Heading,
  List,
  ListItem,
  Link,
  Strong,
  InlineCode,
  CodeBlock,
  Blockquote,
  Rule,
  Table,
  TableHeader,
  TableData,
  Image,
});

export { Prose };
export type {
  ProseBlockquoteProps,
  ProseCodeBlockProps,
  ProseHeadingLevel,
  ProseHeadingProps,
  ProseImageProps,
  ProseInlineCodeProps,
  ProseLinkProps,
  ProseListItemProps,
  ProseListProps,
  ProseParagraphProps,
  ProseRootProps,
  ProseRuleProps,
  ProseStrongProps,
  ProseTableDataProps,
  ProseTableHeaderProps,
  ProseTableProps,
};
