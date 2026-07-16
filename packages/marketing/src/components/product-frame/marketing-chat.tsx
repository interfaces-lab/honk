import { ToolCallLine, UserMessage, WorkGroup } from "@honk/ui";
import { useEffect, useRef } from "react";

import { cn } from "../../lib/classes";
import { MarketingComposer } from "./marketing-composer";
import type { MarketingTimelineItem } from "./demo-animation";
import type { MarketingDemoThreadId } from "./demo-data";

const COMPOSER_RESERVE_PX = 112;

function TimelineMessage(props: { item: MarketingTimelineItem; entering: boolean }) {
  if (props.item.kind === "user") {
    return (
      <div className={cn("w-full min-w-0", props.entering && "marketing-demo-enter")}>
        <UserMessage>
          <div className="text-body text-primary">{props.item.text}</div>
        </UserMessage>
      </div>
    );
  }

  if (props.item.kind === "assistant") {
    return (
      <div className={cn("w-full min-w-0", props.entering && "marketing-demo-enter")}>
        <div className="box-border flex w-full min-w-0" data-assistant-transcript-row="">
          <div className="w-full min-w-0 text-body text-primary">{props.item.text}</div>
        </div>
      </div>
    );
  }

  const tool = props.item.toolCall.tool.value;
  const detail = tool.path ?? tool.details;
  return (
    <div className={cn("w-full min-w-0", props.entering && "marketing-demo-enter")}>
      {props.item.preview === undefined ? (
        <ToolCallLine
          verb={tool.action}
          detail={detail}
          state={props.item.loading ? "running" : "done"}
          added={tool.stats?.additions}
          removed={tool.stats?.deletions}
        />
      ) : (
        <WorkGroup>
          <WorkGroup.Header
            verb={tool.action}
            detail={detail}
            added={tool.stats?.additions}
            removed={tool.stats?.deletions}
          />
          <WorkGroup.Preview isScrollable>
            <WorkGroup.OutputStrip>{props.item.preview}</WorkGroup.OutputStrip>
          </WorkGroup.Preview>
        </WorkGroup>
      )}
    </div>
  );
}

export function MarketingChat(props: {
  activeThreadId: MarketingDemoThreadId;
  messages: readonly MarketingTimelineItem[];
  stepIndex: number;
}) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const previousStepRef = useRef(props.stepIndex);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }

    if (props.stepIndex !== previousStepRef.current) {
      timeline.scrollTo({ top: timeline.scrollHeight, behavior: "smooth" });
      previousStepRef.current = props.stepIndex;
    }
  }, [props.messages.length, props.stepIndex]);

  return (
    <div className="relative flex size-full min-h-0 flex-col bg-base">
      <div
        key={props.activeThreadId}
        ref={timelineRef}
        data-chat-timeline-scroll=""
        className="max-w-agent-chat mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-y-contain px-4 pt-3"
        style={{
          gap: "var(--chat-timeline-row-gap)",
          paddingBottom: `calc(${COMPOSER_RESERVE_PX}px + var(--chat-timeline-row-gap))`,
        }}
      >
        {props.messages.map((item, index) => (
          <TimelineMessage
            key={`${props.stepIndex}-${index}`}
            entering={index === props.messages.length - 1}
            item={item}
          />
        ))}
      </div>

      <div
        aria-hidden
        data-chat-bottom-gradient-overlay=""
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-32 bg-[linear-gradient(to_top,var(--honk-color-bg-base)_0,color-mix(in_srgb,var(--honk-color-bg-base)_82%,transparent)_52%,transparent_100%)]"
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-4 pb-3">
        <div className="max-w-agent-chat pointer-events-auto mx-auto w-full">
          <MarketingComposer />
        </div>
      </div>
    </div>
  );
}
