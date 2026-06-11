import { StatusDot as UiStatusDot } from "@multi/multikit/status-dot";
import type { ComponentProps } from "react";

import { ChatLoaderGlyph } from "~/components/chat/message/chat-loader";
import type { SidebarChatItem } from "./types";

type UiStatusDotState = NonNullable<ComponentProps<typeof UiStatusDot>["state"]>;

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

export function StatusDot(props: { item: SidebarChatItem }) {
  if (props.item.state === "running") {
    return <ChatLoaderGlyph aria-hidden maxExtent={16} role="presentation" speed={1.1} />;
  }

  if (props.item.kind === "draft") {
    return <SidebarDot state="draft" />;
  }

  return <SidebarDot state={sidebarDotStateForItem(props.item)} />;
}

export function StatusSlot(props: { item: SidebarChatItem }) {
  return (
    <span
      className="flex size-5 shrink-0 items-center justify-center text-multi-icon-secondary"
      data-agent-sidebar-status=""
    >
      <StatusDot item={props.item} />
    </span>
  );
}
