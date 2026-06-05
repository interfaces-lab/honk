import type {
  EnvironmentId,
  OrchestrationSessionStatus,
  ProjectId,
  ScopedProjectRef,
  ScopedThreadRef,
  ThreadId,
} from "@multi/contracts";

import type { HarnessKind } from "~/lib/ui-session-types";

export interface SidebarDraftSummary {
  id: string;
  text: string;
  attachmentCount: number;
  firstAttachmentName: string | null;
  cwd: string;
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  workspaceProjectRef: ScopedProjectRef | null;
  projectCwd: string;
  updatedAt: string;
}

export interface SidebarProjectSummary {
  id: ProjectId;
  environmentId: EnvironmentId;
  title: string;
  cwd: string;
}

export interface SidebarThreadSummary {
  id: ThreadId;
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  workspaceProjectRef: ScopedProjectRef | null;
  projectCwd: string;
  harness?: HarnessKind;
  path: string;
  cwd: string;
  name: string | null;
  createdAt: string;
  modifiedAt: string;
  latestReadableAt?: string | null;
  messageCount: number;
  firstMessage: string;
  isStreaming: boolean;
  orchestrationStatus?: OrchestrationSessionStatus | null;
  needsAttention?: boolean;
}

export type SidebarThreadState = "idle" | "running" | "needs_attention" | "error";

interface SidebarChatItemBase {
  title: string;
  updatedAt: string;
  ago: string;
  cwd: string;
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  workspaceProjectRef: ScopedProjectRef | null;
  projectCwd: string;
}

export type SidebarChatItem =
  | (SidebarChatItemBase & {
      id: ThreadId;
      kind: "thread";
      state: SidebarThreadState;
      unread: boolean;
      pinned: boolean;
      latestReadableAt: string | null;
      threadRef: ScopedThreadRef;
    })
  | (SidebarChatItemBase & {
      id: string;
      kind: "draft";
      state: "draft";
      unread: false;
    });

export interface SidebarSectionModel {
  id: string;
  label: string;
  cwd: string;
  active: boolean;
  canCreateAgent?: boolean;
  canOpenInEditor?: boolean;
  environmentId?: EnvironmentId;
  projectId?: ProjectId;
  projectRef?: ScopedProjectRef;
  projectCwd?: string;
  projectOrderKeys?: readonly string[];
  projectStateKey?: string;
  sectionThreadRefs: readonly ScopedThreadRef[];
  threadRefs: readonly ScopedThreadRef[];
  items: readonly SidebarChatItem[];
}

export interface AgentSidebarProps {
  sections: SidebarSectionModel[];
  selectedId: string | null;
  onSelectAgent: (id: string) => void;
  onNewAgent?: (cwd: string) => void;
  onPrefetchAgent?: (id: string) => void;
  loading?: boolean;
  error?: boolean;
}
