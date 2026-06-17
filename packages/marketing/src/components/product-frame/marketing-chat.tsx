import { ChatMessageBubble } from "~/components/chat/message/message-surface";
import { ToolCallRenderer } from "~/components/chat/message/tool-renderer";
import { cn } from "@honk/honkkit/utils";
import { useEffect, useRef } from "react";

import { useMarketingResolvedTheme } from "../../hooks/use-marketing-resolved-theme";

import { MarketingComposer } from "./marketing-composer";
import type { MarketingTimelineItem } from "./demo-animation";

const COMPOSER_RESERVE_PX = 112;

function TimelineMessage(props: {
  item: MarketingTimelineItem;
  entering: boolean;
  resolvedTheme: "light" | "dark";
  stepIndex: number;
}) {
  if (props.item.kind === "user") {
    return (
      <div className={cn("w-full min-w-0", props.entering && "marketing-demo-enter")}>
        <ChatMessageBubble
          messageRole="user"
          body={<div className="text-conversation text-honk-fg-primary">{props.item.text}</div>}
        />
      </div>
    );
  }

  if (props.item.kind === "assistant") {
    return (
      <div className={cn("w-full min-w-0", props.entering && "marketing-demo-enter")}>
        <div className="box-border flex w-full min-w-0" data-assistant-transcript-row="">
          <ChatMessageBubble
            messageRole="assistant"
            body={<div className="text-conversation text-honk-fg-primary">{props.item.text}</div>}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-full min-w-0", props.entering && "marketing-demo-enter")}>
      <ToolCallRenderer
        key={`${props.stepIndex}-${props.item.callId}-${props.item.loading ? "loading" : "done"}`}
        callId={props.item.callId}
        toolCall={props.item.toolCall}
        loading={props.item.loading}
        conversationDensity="detailed"
        defaultEditExpanded={props.item.defaultEditExpanded ?? false}
        resolvedTheme={props.resolvedTheme}
      />
    </div>
  );
}

export function MarketingChat(props: {
  messages: readonly MarketingTimelineItem[];
  stepIndex: number;
}) {
  const resolvedTheme = useMarketingResolvedTheme();
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
    <div className="relative flex h-full min-h-0 w-full flex-col bg-honk-chat">
      <div
        ref={timelineRef}
        data-chat-timeline-scroll=""
        className="mx-auto flex min-h-0 w-full max-w-agent-chat flex-1 flex-col overflow-y-auto overscroll-y-contain px-4 pt-3"
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
            resolvedTheme={resolvedTheme}
            stepIndex={props.stepIndex}
          />
        ))}
      </div>

      <div
        aria-hidden
        data-chat-bottom-gradient-overlay=""
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-32 bg-[linear-gradient(to_top,var(--honk-shell-center-surface-background)_0,color-mix(in_srgb,var(--honk-shell-center-surface-background)_82%,transparent)_52%,transparent_100%)]"
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-4 pb-3">
        <div className="pointer-events-auto mx-auto w-full max-w-agent-chat">
          <MarketingComposer />
        </div>
      </div>
    </div>
  );
}
