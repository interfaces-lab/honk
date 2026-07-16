import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { proseCodeBlockStyle } from "./prose-code-block";
import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars, fontVars, proseVars, radiusVars, spaceVars } from "./tokens.stylex";

// Blockquote rule is private hairline geometry, not a theme token.
const PROSE_HAIRLINE = "1px";
// Inline code inset and link underline offset are glyph anatomy, not layout tokens.
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
      default: proseVars["--honk-prose-item-gap"],
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
  style?: StyleProp<HonkStyle>;
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

function ProseRoot({ style, ...props }: ProseRootProps): React.ReactElement {
  return <div data-slot="prose" {...applyStyle(stylex.props(styles.root), style)} {...props} />;
}

function Paragraph({ style, ...props }: ProseParagraphProps): React.ReactElement {
  return (
    <p
      data-slot="prose-paragraph"
      {...applyStyle(stylex.props(styles.measure, styles.flow, styles.paragraph), style)}
      {...props}
    />
  );
}

const headingElements = { 1: "h1", 2: "h2", 3: "h3" } as const;

function Heading({ level = 2, style, ...props }: ProseHeadingProps): React.ReactElement {
  const Component = headingElements[level];
  return (
    <Component
      data-slot="prose-heading"
      {...applyStyle(
        stylex.props(
          styles.measure,
          styles.heading,
          level === 1 ? styles.headingLarge : styles.headingSmall,
        ),
        style,
      )}
      {...props}
    />
  );
}

function List({ ordered = false, style, ...props }: ProseListProps): React.ReactElement {
  const Component = ordered ? "ol" : "ul";
  return (
    <Component
      data-slot="prose-list"
      {...applyStyle(
        stylex.props(
          styles.measure,
          styles.flow,
          styles.list,
          ordered ? styles.ordered : styles.unordered,
        ),
        style,
      )}
      {...props}
    />
  );
}

function ListItem({ style, ...props }: ProseListItemProps): React.ReactElement {
  return <li {...applyStyle(stylex.props(styles.listItem), style)} {...props} />;
}

function Link({ style, ...props }: ProseLinkProps): React.ReactElement {
  return <a {...applyStyle(stylex.props(styles.link), style)} {...props} />;
}

function Strong({ style, ...props }: ProseStrongProps): React.ReactElement {
  return <strong {...applyStyle(stylex.props(styles.strong), style)} {...props} />;
}

function InlineCode({ style, ...props }: ProseInlineCodeProps): React.ReactElement {
  return <code {...applyStyle(stylex.props(styles.inlineCode), style)} {...props} />;
}

function CodeBlock({ style, ...props }: ProseCodeBlockProps): React.ReactElement {
  return <pre {...applyStyle(stylex.props(proseCodeBlockStyle), style)} {...props} />;
}

function Blockquote({ style, ...props }: ProseBlockquoteProps): React.ReactElement {
  return (
    <blockquote
      {...applyStyle(stylex.props(styles.measure, styles.flow, styles.blockquote), style)}
      {...props}
    />
  );
}

function Rule({ style, ...props }: ProseRuleProps): React.ReactElement {
  return <hr {...applyStyle(stylex.props(styles.measure, styles.rule), style)} {...props} />;
}

function Table({ style, ...props }: ProseTableProps): React.ReactElement {
  return (
    <div {...stylex.props(styles.tableWrap)}>
      <table {...applyStyle(stylex.props(styles.table), style)} {...props} />
    </div>
  );
}

function TableHeader({ style, ...props }: ProseTableHeaderProps): React.ReactElement {
  return <th {...applyStyle(stylex.props(styles.tableCell, styles.tableHead), style)} {...props} />;
}

function TableData({ style, ...props }: ProseTableDataProps): React.ReactElement {
  return <td {...applyStyle(stylex.props(styles.tableCell), style)} {...props} />;
}

function Image({ style, ...props }: ProseImageProps): React.ReactElement {
  return <img {...applyStyle(stylex.props(styles.image), style)} {...props} />;
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
