import { AgentSidebarBody } from "./body";
import { SidebarEmptyState, SidebarErrorState, SkeletonRows } from "./empty-states";
import type { AgentSidebarProps } from "./types";

export type { AgentSidebarProps } from "./types";

export function AgentSidebar(props: AgentSidebarProps) {
  if (props.loading) {
    return <SkeletonRows />;
  }

  if (props.error) {
    return <SidebarErrorState />;
  }

  if (props.sections.length === 0 && props.onOpenWorkspace === undefined) {
    return <SidebarEmptyState />;
  }

  return <AgentSidebarBody {...props} />;
}
