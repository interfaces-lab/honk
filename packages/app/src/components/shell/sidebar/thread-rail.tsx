import type { SidebarSectionModel } from "~/lib/sidebar-chat-view-model";
import { AgentList } from "~/components/shell/agents/list";

export function ThreadRail(props: {
  sections: SidebarSectionModel[];
  selectedId: string | null;
  onSelectAgent: (id: string) => void;
  onNewAgent?: (cwd: string) => void;
  onPrefetchAgent?: (id: string) => void;
  loading?: boolean;
  error?: boolean;
}) {
  return (
    <>
      <AgentList
        sections={props.sections}
        selectedId={props.selectedId}
        onSelectAgent={props.onSelectAgent}
        {...(props.onNewAgent ? { onNewAgent: props.onNewAgent } : {})}
        {...(props.onPrefetchAgent ? { onPrefetchAgent: props.onPrefetchAgent } : {})}
        {...(props.loading !== undefined ? { loading: props.loading } : {})}
        {...(props.error !== undefined ? { error: props.error } : {})}
      />
    </>
  );
}
