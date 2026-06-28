import { StatusDot as UiStatusDot } from "@honk/honkkit/status-dot";
import { IconArchive1 } from "central-icons";
import { useEffect, useRef, useState, type ComponentProps } from "react";

import { ChatLoaderGlyph } from "@honk/honkkit/conversation-loader";
import type { SidebarChatItem } from "./types";

type UiStatusDotState = NonNullable<ComponentProps<typeof UiStatusDot>["state"]>;
const FINISH_ANIMATION_MS = 720;

function SidebarDot(props: { state: UiStatusDotState }) {
  return (
    <UiStatusDot state={props.state} className="size-4 shrink-0" role="presentation" aria-hidden />
  );
}

function sidebarDotStateForItem(item: SidebarChatItem): UiStatusDotState {
  if (item.state === "error") return "critical";
  if (item.state === "stopped") return "inactive";
  if (item.state === "needs_attention") return "needsAttention";
  return item.unread ? "doneUnseen" : "doneSeen";
}

export function StatusDot(props: { finishing?: boolean | undefined; item: SidebarChatItem }) {
  if (props.item.kind === "thread" && props.item.archived) {
    return <IconArchive1 className="size-4 shrink-0 text-honk-icon-tertiary" aria-hidden />;
  }

  if (props.item.state === "running") {
    return <ChatLoaderGlyph aria-hidden maxExtent={16} role="presentation" speed={1.1} />;
  }

  if (props.item.kind === "draft") {
    return <SidebarDot state="draft" />;
  }

  if (props.finishing) {
    return (
      <span
        className="agent-sidebar-status-finish inline-flex size-4 shrink-0 items-center justify-center"
        aria-hidden
        role="presentation"
      >
        <SidebarDot state={sidebarDotStateForItem(props.item)} />
      </span>
    );
  }

  return <SidebarDot state={sidebarDotStateForItem(props.item)} />;
}

export function StatusSlot(props: { item: SidebarChatItem }) {
  const running = props.item.state === "running";
  const previousRef = useRef({ id: props.item.id, running });
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { id: props.item.id, running };

    if (previous.id !== props.item.id) {
      setFinishing(false);
      return;
    }

    if (running) {
      setFinishing(false);
      return;
    }

    if (!previous.running) {
      return;
    }

    setFinishing(true);
    const timeoutId = setTimeout(() => {
      setFinishing(false);
    }, FINISH_ANIMATION_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [props.item.id, running]);

  return (
    <span
      className="flex size-5 shrink-0 items-center justify-center text-honk-icon-secondary"
      data-agent-sidebar-status=""
      data-agent-sidebar-status-finishing={finishing ? "true" : undefined}
    >
      <StatusDot finishing={finishing} item={props.item} />
    </span>
  );
}
