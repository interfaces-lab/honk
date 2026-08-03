import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { proseCodeBlockStyle } from "./prose-code-block";
import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { borderVars, colorVars, fontVars, proseVars, radiusVars } from "./tokens.stylex";

// Link underline thickness is private glyph geometry, not a surface-border token.
const PROSE_HAIRLINE = "1px";
const ProseListItemContext = React.createContext(false);

const styles = stylex.create({
  root: {
    width: "100%",
    minWidth: 0,
    color: colorVars["--honk-color-fg"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: proseVars["--honk-prose-size"],
    lineHeight: proseVars["--honk-prose-leading"],
    overflowWrap: "anywhere",
  },
  measure: {
    width: "100%",
    maxWidth: proseVars["--honk-prose-measure"],
  },
  flow: {
    marginBlockStart: {
      default: proseVars["--honk-prose-flow-gap"],
      ":first-child": 0,
    },
    marginBlockEnd: {
      default: proseVars["--honk-prose-flow-gap"],
      ":last-child": 0,
    },
  },
  paragraph: {
    textWrap: "pretty",
  },
  heading: {
    marginBlockEnd: {
      default: proseVars["--honk-prose-tight-gap"],
      ":last-child": 0,
    },
    color: colorVars["--honk-color-fg"],
    fontWeight: fontVars["--honk-font-weight-semibold"],
    lineHeight: proseVars["--honk-prose-heading-leading"],
    textWrap: "balance",
    scrollMarginBlockStart: proseVars["--honk-prose-section-gap"],
  },
  heading1: {
    marginBlockStart: {
      default: proseVars["--honk-prose-heading-1-gap"],
      ":first-child": 0,
    },
    fontSize: proseVars["--honk-prose-heading-1-size"],
  },
  heading2: {
    marginBlockStart: {
      default: proseVars["--honk-prose-section-gap"],
      ":first-child": 0,
    },
    fontSize: proseVars["--honk-prose-heading-2-size"],
  },
  heading3: {
    marginBlockStart: {
      default: proseVars["--honk-prose-section-gap"],
      ":first-child": 0,
    },
    fontSize: proseVars["--honk-prose-heading-3-size"],
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: proseVars["--honk-prose-flow-gap"],
    marginBlock: proseVars["--honk-prose-flow-gap"],
    paddingInlineStart: proseVars["--honk-prose-list-indent"],
  },
  nestedList: {
    marginBlockStart: proseVars["--honk-prose-tight-gap"],
  },
  unordered: {
    listStyleType: "disc",
  },
  ordered: {
    listStyleType: "decimal",
  },
  listItem: {
    padding: 0,
    wordBreak: "break-word",
  },
  listItemParagraph: {
    marginBlockStart: 0,
    marginBlockEnd: 0,
  },
  link: {
    color: {
      default: colorVars["--honk-color-accent"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-fg"] },
    },
    textDecorationLine: "underline",
    textDecorationThickness: PROSE_HAIRLINE,
    textUnderlineOffset: "2px",
  },
  strong: {
    color: colorVars["--honk-color-fg"],
    fontWeight: fontVars["--honk-font-weight-semibold"],
  },
  // Inline code sits mid-sentence in prose: mono family marks it as a literal, and the tinted
  // chip keeps it legible against the reading line. Fenced code blocks own the heavier
  // container chrome.
  inlineCode: {
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px inline-code inset is fixed glyph anatomy, no spacing token owns it
    paddingBlock: "2px",
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px inline-code inset is fixed glyph anatomy, no spacing token owns it
    paddingInline: "2px",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    color: colorVars["--honk-color-fg"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: proseVars["--honk-prose-inline-code-size"],
  },
  blockquote: {
    marginInline: 0,
    paddingBlock: proseVars["--honk-prose-flow-gap"],
    paddingInlineStart: proseVars["--honk-prose-quote-inset"],
    borderInlineStartWidth: proseVars["--honk-prose-quote-border"],
    borderInlineStartStyle: "solid",
    borderInlineStartColor: colorVars["--honk-color-border-strong"],
    color: colorVars["--honk-color-fg-secondary"],
  },
  rule: {
    height: 0,
    marginBlock: proseVars["--honk-prose-section-gap"],
    borderWidth: 0,
    borderBlockStartWidth: borderVars["--honk-border-hairline"],
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colorVars["--honk-color-border-muted"],
    backgroundColor: "transparent",
  },
  tableWrap: {
    width: "100%",
    maxWidth: "100%",
    marginBlock: proseVars["--honk-prose-table-gap"],
    overflowX: "auto",
    overscrollBehaviorX: "contain",
    borderWidth: borderVars["--honk-border-hairline"],
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-muted"],
    borderRadius: radiusVars["--honk-radius-control"],
  },
  table: {
    width: "max-content",
    minWidth: "100%",
    borderCollapse: "collapse",
    fontVariantNumeric: "tabular-nums",
  },
  tableCell: {
    paddingBlock: proseVars["--honk-prose-table-cell-block"],
    paddingInline: proseVars["--honk-prose-table-cell-inline"],
    borderBlockEndWidth: borderVars["--honk-border-hairline"],
    borderBlockEndStyle: "solid",
    borderBlockEndColor: colorVars["--honk-color-border-muted"],
    borderInlineEndWidth: {
      default: borderVars["--honk-border-hairline"],
      ":last-child": 0,
    },
    borderInlineEndStyle: "solid",
    borderInlineEndColor: colorVars["--honk-color-border-muted"],
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
    marginBlock: proseVars["--honk-prose-media-gap"],
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
  const isInListItem = React.useContext(ProseListItemContext);
  return (
    <p
      data-slot="prose-paragraph"
      {...applyStyle(
        stylex.props(
          styles.measure,
          styles.flow,
          styles.paragraph,
          isInListItem && styles.listItemParagraph,
        ),
        style,
      )}
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
          level === 1 ? styles.heading1 : level === 2 ? styles.heading2 : styles.heading3,
        ),
        style,
      )}
      {...props}
    />
  );
}

function List({ ordered = false, style, ...props }: ProseListProps): React.ReactElement {
  const Component = ordered ? "ol" : "ul";
  const isInListItem = React.useContext(ProseListItemContext);
  return (
    <Component
      data-slot="prose-list"
      {...applyStyle(
        stylex.props(
          styles.measure,
          styles.list,
          isInListItem && styles.nestedList,
          ordered ? styles.ordered : styles.unordered,
        ),
        style,
      )}
      {...props}
    />
  );
}

function ListItem({ style, ...props }: ProseListItemProps): React.ReactElement {
  return (
    <ProseListItemContext.Provider value>
      <li
        data-slot="prose-list-item"
        {...applyStyle(stylex.props(styles.listItem), style)}
        {...props}
      />
    </ProseListItemContext.Provider>
  );
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
