import * as stylex from "@stylexjs/stylex";
import { AssistantMessage } from "@honk/ui/assistant-message";
import { Button } from "@honk/ui/button";
import { Text } from "@honk/ui/text";
import { ToolCallLine } from "@honk/ui/tool-call";
import { UserMessage } from "@honk/ui/user-message";
import { WorkGroup } from "@honk/ui/work-group";
import {
  composerStateBandHeightPx,
  composerVars,
  controlVars,
  spaceVars,
  zVars,
} from "@honk/ui/tokens.stylex";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/classes";
import { MarketingComposer } from "./marketing-composer";
import { marketingDemoChips } from "./demo-interaction";
import type { MarketingTimelineItem } from "./demo-animation";
import { marketingDemoThreadTitle, type MarketingDemoThreadId } from "./demo-data";

// Geometry mirrors the shipped thread panel: app/src/thread/surface.tsx owns the surface,
// header, and composer-overlay insets; app/src/thread/transcript.tsx owns the scrollport.
const styles = stylex.create({
  surface: {
    position: "relative",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    width: "100%",
    maxWidth: composerVars["--honk-composer-max-width"],
    marginInline: "auto",
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    paddingBlock: spaceVars["--honk-space-panel-pad"],
    paddingInline: spaceVars["--honk-space-gutter"],
    boxSizing: "border-box",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    flexShrink: 0,
    minWidth: 0,
    paddingInline: spaceVars["--honk-space-gutter"],
  },
  streamFrame: {
    position: "relative",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    width: "100%",
  },
  stream: {
    height: "100%",
    width: "100%",
    paddingInline: spaceVars["--honk-space-gutter"],
    overflowY: "auto",
    // Copied from the app transcript: black carries mask alpha only, so the scrollbar strip
    // stays opaque while the timeline fades behind the measured composer overlay.
    maskImage:
      "linear-gradient(black, black), linear-gradient(to bottom, black 0, black calc(100% - var(--_transcript-overlay-height)), transparent calc(100% - 38px), transparent 100%), linear-gradient(black, black)",
    maskPosition: "left top, left top, right top",
    maskRepeat: "no-repeat",
    maskSize: "0 100%, calc(100% - 20px) 100%, 20px 100%",
  },
  composerOverlay: {
    position: "absolute",
    zIndex: zVars["--honk-z-stage-float"],
    insetInlineStart: `calc(${spaceVars["--honk-space-gutter"]} * 2)`,
    insetInlineEnd: `calc(${spaceVars["--honk-space-gutter"]} * 2)`,
    insetBlockEnd: spaceVars["--honk-space-panel-pad"],
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
  },
  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: controlVars["--honk-control-gap"],
  },
});

const dynamic = stylex.create({
  streamClearance: (px: number) => ({
    paddingBlockEnd: `${px}px`,
    "--_transcript-overlay-height": `${px}px`,
  }),
});

// Mirrors transcriptRowGapPx in app/src/thread/transcript.tsx: consecutive assistant blocks
// inside one turn sit at the gutter, every other boundary gets the wider section gap.
function timelineRowGap(items: readonly MarketingTimelineItem[], index: number) {
  if (index === 0) return undefined;
  if (items[index - 1]?.kind === "user" || items[index]?.kind === "user") {
    return spaceVars["--honk-space-panel-pad"];
  }
  return spaceVars["--honk-space-gutter"];
}

function timelineBody(item: MarketingTimelineItem) {
  if (item.kind === "user") {
    return (
      <UserMessage>
        <UserMessage.Preview>{item.text}</UserMessage.Preview>
      </UserMessage>
    );
  }

  if (item.kind === "assistant") {
    return <AssistantMessage>{item.text}</AssistantMessage>;
  }

  const tool = item.toolCall.tool.value;
  const detail = tool.path ?? tool.details;
  if (item.preview === undefined) {
    return (
      <ToolCallLine
        verb={tool.action}
        detail={detail}
        state={item.loading ? "running" : "done"}
        added={tool.stats?.additions}
        removed={tool.stats?.deletions}
      />
    );
  }

  return (
    <WorkGroup>
      <WorkGroup.Header
        verb={tool.action}
        detail={detail}
        added={tool.stats?.additions}
        removed={tool.stats?.deletions}
      />
      <WorkGroup.Preview isScrollable>
        <WorkGroup.OutputStrip>{item.preview}</WorkGroup.OutputStrip>
      </WorkGroup.Preview>
    </WorkGroup>
  );
}

function TimelineMessage(props: {
  item: MarketingTimelineItem;
  entering: boolean;
  gap: string | undefined;
}) {
  return (
    <div
      className={cn("w-full min-w-0", props.entering && "marketing-demo-enter")}
      style={{ marginBlockStart: props.gap }}
    >
      {timelineBody(props.item)}
    </div>
  );
}

export function MarketingChat(props: {
  activeThreadId: MarketingDemoThreadId;
  messages: readonly MarketingTimelineItem[];
  busy: boolean;
  onSubmitPrompt: (text: string) => void;
}) {
  // The app measures its composer obstruction and reserves that height under the transcript
  // (app/src/thread/surface.tsx). Same contract here, same initial guess.
  const [composerClearancePx, setComposerClearancePx] = useState(composerStateBandHeightPx * 2);
  const composerOverlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = composerOverlayRef.current;
    if (element === null) return;

    const observer = new ResizeObserver(() => {
      setComposerClearancePx(Math.ceil(element.getBoundingClientRect().height));
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div {...stylex.props(styles.surface)}>
      <header {...stylex.props(styles.header)}>
        <Text as="div" size="xl" weight="semibold" truncate>
          {marketingDemoThreadTitle(props.activeThreadId)}
        </Text>
        <Text as="p" size="xs" tone="faint" family="mono" truncate>
          ~/Developer/honk
        </Text>
      </header>

      <div {...stylex.props(styles.streamFrame)}>
        <div
          key={props.activeThreadId}
          aria-label="Thread transcript"
          data-honk-scrollport="balanced"
          {...stylex.props(styles.stream, dynamic.streamClearance(composerClearancePx))}
        >
          {props.messages.map((item, index) => (
            <TimelineMessage
              key={`${props.activeThreadId}-${index}`}
              entering={index === props.messages.length - 1}
              gap={timelineRowGap(props.messages, index)}
              item={item}
            />
          ))}
        </div>
      </div>

      <div ref={composerOverlayRef} {...stylex.props(styles.composerOverlay)}>
        <div {...stylex.props(styles.chipRow)}>
          {marketingDemoChips.map((chip) => (
            <Button
              key={chip}
              type="button"
              size="sm"
              disabled={props.busy}
              onClick={() => props.onSubmitPrompt(chip)}
            >
              {chip}
            </Button>
          ))}
        </div>
        <MarketingComposer onSubmit={props.onSubmitPrompt} busy={props.busy} />
      </div>
    </div>
  );
}
