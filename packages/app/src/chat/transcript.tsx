// The chat transcript, rendered in the turn grammar (spec/conversation.md):
// every turn shows at its effective disclosure layer — L0 collapses to the
// worked-for header and summary, L1 shows headlines with read-shaped work
// grouped, L2 shows every row, L3 is a row's own expansion. The live turn
// streams prose as ordinary markdown while the TurnStatus ticker names the
// active tool, and every settled turn shows what the agent edited.

import { ChangeReceipt, ToolCallLine, UserMessage, WorkGroup, type ToolCallState } from "@honk/ui";
import { AssistantMessage } from "@honk/ui/assistant-message";
import { CompactionDivider } from "@honk/ui/compaction-divider";
import { NoticeRow } from "@honk/ui/notice-row";
import { colorVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import type { ConversationDensity } from "@honk/shared/conversation-density";

import { Markdown } from "../markdown";
import type { ConversationItem, DisclosureLayer, TickerState, TurnSegment, TurnStep, TurnView } from "./chat-model";
import { effectiveLayer, segmentRows } from "./chat-model";
import { TurnStatus } from "./turn-status";

export const TRANSCRIPT_MAX_WIDTH = "760px";
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
  turn: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
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
  // The settled header is the turn's collapse control; the button chrome is
  // the header itself, so the wrapper stays bare.
  headerButton: {
    display: "block",
    width: "fit-content",
    maxWidth: "100%",
    padding: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    textAlign: "left",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "inherit",
  },
  // Transcript markers (model choice, workspace moves) are context, not
  // messages: a quiet centered line, not a warning banner.
  notice: {
    alignSelf: "center",
    fontSize: fontVars["--honk-font-size-caption"],
    color: colorVars["--honk-color-text-muted"],
  },
});

const toolCallState: Record<TurnStep["state"], ToolCallState> = {
  running: "running",
  ok: "done",
  error: "failed",
};

function StepRow({ step }: { readonly step: TurnStep }): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const bodyId = `tool-io-${step.key}`;
  return (
    <div>
      <ToolCallLine
        verb={step.name}
        {...(step.detail === null ? {} : { detail: step.detail })}
        state={toolCallState[step.state]}
        isExpanded={expanded}
        onToggle={() => {
          setExpanded((open) => !open);
        }}
        aria-controls={bodyId}
      />
      {expanded && (
        <div id={bodyId}>
          {step.args.length > 0 && <pre {...stylex.props(styles.toolIo)}>{step.args}</pre>}
          {step.output.length > 0 && <pre {...stylex.props(styles.toolIo)}>{step.output}</pre>}
        </div>
      )}
    </div>
  );
}

/** A rolled run of reads: one line until opened, then every row (spec §4). */
function ReadGroup({ steps }: { readonly steps: readonly TurnStep[] }): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const isRunning = steps.some((step) => step.state === "running");
  return (
    <WorkGroup isRunning={isRunning}>
      <WorkGroup.Header
        verb="Read"
        detail={`${String(steps.length)} files`}
        isRunning={isRunning}
        isExpanded={expanded}
        onToggle={() => {
          setExpanded((open) => !open);
        }}
      />
      {expanded && steps.map((step) => <StepRow key={step.key} step={step} />)}
    </WorkGroup>
  );
}

function SegmentView({
  segment,
  layer,
  live,
}: {
  readonly segment: TurnSegment;
  readonly layer: DisclosureLayer;
  readonly live: boolean;
}): React.ReactElement {
  return (
    <div>
      {segment.headline !== null && <Markdown text={segment.headline} isStreaming={live} />}
      {layer >= 2
        ? segment.steps.map((step) => <StepRow key={step.key} step={step} />)
        : segmentRows(segment.steps).map((row) =>
            row.kind === "step" ? (
              <StepRow key={row.step.key} step={row.step} />
            ) : (
              <ReadGroup key={row.steps[0]?.key ?? segment.id} steps={row.steps} />
            ),
          )}
    </div>
  );
}

function TurnBlock({
  turn,
  live,
  ticker,
  density,
}: {
  readonly turn: TurnView;
  readonly live: boolean;
  readonly ticker: TickerState;
  readonly density: ConversationDensity;
}): React.ReactElement {
  // The per-turn override: a click wins over the setting for this turn only.
  const [override, setOverride] = React.useState<DisclosureLayer | null>(null);
  const phase = live ? "running" : "settled";
  const layer = effectiveLayer(override, density, phase);

  const status = (
    <TurnStatus
      phase={phase}
      ticker={ticker}
      outcome={turn.outcome}
      durationMs={turn.durationMs}
    />
  );

  return (
    <div {...stylex.props(styles.turn)}>
      <UserMessage>{turn.userText}</UserMessage>
      <AssistantMessage isStreaming={live}>
        {layer >= 1 &&
          turn.segments.map((segment) => (
            <SegmentView key={segment.id} segment={segment} layer={layer} live={live} />
          ))}
        {live ? (
          status
        ) : (
          // Clicks walk the layers: the header opens a collapsed turn to the
          // density's expanded form and collapses it back (spec §2).
          <button
            type="button"
            aria-expanded={layer >= 1}
            data-canonical-control-exception="Turn disclosure header: the TurnStatus surface is the control's whole chrome; button styling would double it."
            onClick={() => {
              setOverride(layer === 0 ? (density === "detailed" ? 2 : 1) : 0);
            }}
            {...stylex.props(styles.headerButton)}
          >
            {status}
          </button>
        )}
        {turn.summary !== null && <Markdown text={turn.summary} isStreaming={live} />}
        {turn.error !== null && <NoticeRow severity="error" message={turn.error} />}
        {!live && turn.files.length > 0 && (
          // What the agent edited, at every settle — the change receipt maps
          // Git's statuses one to one.
          <ChangeReceipt
            files={turn.files.map((file) => ({
              path: file.file,
              additions: file.additions,
              deletions: file.deletions,
              status: file.status,
            }))}
          />
        )}
      </AssistantMessage>
    </div>
  );
}

export function ChatTranscript({
  items,
  running,
  ticker,
  density,
}: {
  readonly items: readonly ConversationItem[];
  readonly running: boolean;
  readonly ticker: TickerState;
  readonly density: ConversationDensity;
}): React.ReactElement {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const lastTurn = items.findLast(
    (item): item is Extract<ConversationItem, { kind: "turn" }> => item.kind === "turn",
  );

  // Follow the conversation: keyed on the last turn's identity and content
  // size so streaming keeps the view pinned without a resize observer.
  const lastSize =
    lastTurn === undefined
      ? 0
      : lastTurn.turn.segments.reduce((total, segment) => total + segment.steps.length, 0) +
        (lastTurn.turn.summary?.length ?? 0);
  const followKey =
    lastTurn === undefined
      ? ""
      : `${lastTurn.turn.id}:${String(items.length)}:${String(lastSize)}`;
  React.useEffect(() => {
    const node = scrollRef.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [followKey]);

  return (
    <div ref={scrollRef} {...stylex.props(styles.scroll)}>
      <div {...stylex.props(styles.column)}>
        {items.map((item) => {
          switch (item.kind) {
            case "turn":
              return (
                <TurnBlock
                  key={item.turn.id}
                  turn={item.turn}
                  live={running && item.turn.id === lastTurn?.turn.id}
                  ticker={ticker}
                  density={density}
                />
              );
            case "compaction":
              return (
                <CompactionDivider
                  key={item.id}
                  summary={item.summary}
                  tokensBefore={item.tokensBefore}
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
