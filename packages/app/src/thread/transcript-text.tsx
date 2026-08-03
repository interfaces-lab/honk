import * as stylex from "@stylexjs/stylex";
import { AssistantMessage } from "@honk/ui/assistant-message";
import { IconBranch, IconBubble2 } from "@honk/ui/icons";
import * as React from "react";

import { ChipIcon, chipStyles, SkillText } from "../composer/chip";
import type { InlineContextKind } from "../composer/submission";
import { Markdown } from "../markdown";

const styles = stylex.create({
  preWrap: { whiteSpace: "pre-wrap" },
});

export function AssistantText(props: {
  readonly text: string;
  readonly isStreaming: boolean;
  readonly onOpenFile?: ((path: string) => void) | undefined;
}): React.ReactElement {
  return (
    <AssistantMessage isStreaming={props.isStreaming}>
      <Markdown text={props.text} isStreaming={props.isStreaming} onOpenFile={props.onOpenFile} />
    </AssistantMessage>
  );
}

type InlineContextReference = {
  readonly kind: InlineContextKind;
  readonly label: string;
};

type InlineContextSegment =
  | {
      readonly type: "context";
      readonly value: InlineContextReference;
      readonly offset: number;
    }
  | { readonly type: "text"; readonly value: string; readonly offset: number };

function splitInlineContextReferences(
  text: string,
  contexts: readonly InlineContextReference[],
  cursor = 0,
): readonly InlineContextSegment[] {
  const next = contexts
    .flatMap((context) => {
      if (context.label.length === 0) return [];
      const index = text.indexOf(`@${context.label}`, cursor);
      return index === -1 ? [] : [{ context, index }];
    })
    .sort((a, b) => a.index - b.index || b.context.label.length - a.context.label.length)
    .at(0);
  if (next === undefined) {
    return cursor >= text.length
      ? []
      : [{ type: "text", value: text.slice(cursor), offset: cursor }];
  }
  const end = next.index + next.context.label.length + 1;
  return [
    ...(next.index === cursor
      ? []
      : [
          {
            type: "text" as const,
            value: text.slice(cursor, next.index),
            offset: cursor,
          },
        ]),
    { type: "context", value: next.context, offset: next.index },
    ...splitInlineContextReferences(text, contexts, end),
  ];
}

export function PlainText({
  text,
  contexts = [],
}: {
  readonly text: string;
  readonly contexts?: readonly InlineContextReference[];
}): React.ReactElement {
  return (
    <span {...stylex.props(styles.preWrap)}>
      {splitInlineContextReferences(text, contexts).map((segment) =>
        segment.type === "text" ? (
          <SkillText key={`text:${String(segment.offset)}`} text={segment.value} />
        ) : (
          <span
            key={`context:${String(segment.offset)}`}
            title={segment.value.kind === "chat" ? "Past chat" : "Current branch diff"}
            {...stylex.props(chipStyles.chip)}
          >
            <ChipIcon icon={segment.value.kind === "chat" ? IconBubble2 : IconBranch} />
            <span {...stylex.props(chipStyles.label)}>{segment.value.label}</span>
          </span>
        ),
      )}
    </span>
  );
}
