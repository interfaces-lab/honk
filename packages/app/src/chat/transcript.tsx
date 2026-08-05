// The chat transcript: Pi thread items rendered with the app's real message
// components — UserMessage, AssistantMessage, ToolCallLine, ChangeReceipt,
// CompactionDivider, NoticeRow. No opencode projection in between
// (spec/core.md section 6).

import { ChangeReceipt, ToolCallLine, UserMessage, type ToolCallState } from "@honk/ui";
import { AssistantMessage } from "@honk/ui/assistant-message";
import { CompactionDivider } from "@honk/ui/compaction-divider";
import { NoticeRow } from "@honk/ui/notice-row";
import { colorVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import type { Git } from "@honk/core";

import { Markdown } from "../markdown";
import type { AssistantBlock, ThreadItem } from "./chat-model";

const TRANSCRIPT_MAX_WIDTH = "760px";
const TOOL_IO_MAX_HEIGHT = "240px";

const styles = stylex.create({
  scroll: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
  },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-panel-pad"],
    boxSizing: "border-box",
    width: "100%",
    maxWidth: TRANSCRIPT_MAX_WIDTH,
    marginInline: "auto",
    paddingBlock: spaceVars["--honk-space-panel-pad"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
  },
  thinking: {
    fontSize: fontVars["--honk-font-size-detail"],
    color: colorVars["--honk-color-text-muted"],
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  toolIo: {
    margin: 0,
    maxHeight: TOOL_IO_MAX_HEIGHT,
    overflow: "auto",
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-caption"],
    color: colorVars["--honk-color-text-muted"],
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    paddingInline: spaceVars["--honk-space-gutter"],
  },
  // Transcript markers (model choice, workspace moves) are context, not
  // messages: a quiet centered line, not a warning banner.
  notice: {
    alignSelf: "center",
    fontSize: fontVars["--honk-font-size-caption"],
    color: colorVars["--honk-color-text-muted"],
  },
});

const toolCallState: Record<"running" | "ok" | "error", ToolCallState> = {
  running: "running",
  ok: "done",
  error: "failed",
};


/** The first string argument that looks like a path names most built-in tools' target. */
const toolDetail = (args: string): string | undefined => {
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    const candidate = parsed.path ?? parsed.file ?? parsed.command;
    return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
  } catch {
    return undefined;
  }
};

function ToolBlock({ block }: { readonly block: Extract<AssistantBlock, { kind: "tool" }> }) {
  const [expanded, setExpanded] = React.useState(false);
  const detail = toolDetail(block.args);
  const bodyId = `tool-io-${block.key}`;
  return (
    <div>
      <ToolCallLine
        verb={block.name}
        {...(detail === undefined ? {} : { detail })}
        state={toolCallState[block.state]}
        isExpanded={expanded}
        onToggle={() => {
          setExpanded((open) => !open);
        }}
        aria-controls={bodyId}
      />
      {expanded && (
        <div id={bodyId}>
          {block.args.length > 0 && <pre {...stylex.props(styles.toolIo)}>{block.args}</pre>}
          {block.output.length > 0 && <pre {...stylex.props(styles.toolIo)}>{block.output}</pre>}
        </div>
      )}
    </div>
  );
}

function AssistantItem({ item }: { readonly item: Extract<ThreadItem, { kind: "assistant" }> }) {
  return (
    <AssistantMessage isStreaming={item.live}>
      {item.blocks.map((block) =>
        block.kind === "text" ? (
          <Markdown key={block.key} text={block.text} isStreaming={item.live} />
        ) : block.kind === "thinking" ? (
          <div key={block.key} {...stylex.props(styles.thinking)}>
            {block.text}
          </div>
        ) : (
          <ToolBlock key={block.key} block={block} />
        ),
      )}
      {item.error !== null && <NoticeRow severity="error" message={item.error} />}
    </AssistantMessage>
  );
}

export function ChatTranscript({
  items,
}: {
  readonly items: readonly ThreadItem[];
}): React.ReactElement {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const lastItem = items.at(-1);

  // Follow the conversation: keyed on the last row's identity and content
  // size so streaming text keeps the view pinned without a resize observer.
  const lastSize =
    lastItem?.kind === "assistant"
      ? lastItem.blocks.reduce(
          (total, block) =>
            total + (block.kind === "tool" ? block.output.length : block.text.length),
          0,
        )
      : 0;
  const followKey =
    lastItem === undefined ? "" : `${lastItem.id}:${String(items.length)}:${String(lastSize)}`;
  React.useEffect(() => {
    const node = scrollRef.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [followKey]);

  return (
    <div ref={scrollRef} {...stylex.props(styles.scroll)}>
      <div {...stylex.props(styles.column)}>
        {items.map((item) => {
          switch (item.kind) {
            case "user":
              return <UserMessage key={item.id}>{item.text}</UserMessage>;
            case "assistant":
              return <AssistantItem key={item.id} item={item} />;
            case "compaction":
              return (
                <CompactionDivider
                  key={item.id}
                  summary={item.summary}
                  tokensBefore={item.tokensBefore}
                />
              );
            case "receipt":
              return (
                <ChangeReceipt
                  key={item.id}
                  // Git's change statuses are exactly the receipt's statuses.
                  files={item.files.map((file) => ({
                    path: file.file,
                    additions: file.additions,
                    deletions: file.deletions,
                    status: file.status,
                  }))}
                />
              );
            case "notice":
              return (
                <div key={item.id} {...stylex.props(styles.notice)}>
                  {item.text}
                </div>
              );
          }
        })}
      </div>
    </div>
  );
}
