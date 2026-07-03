import type { EnvironmentId, RepositoryIdentity } from "@honk/shared/environment";
import type { ModelSelection } from "@honk/shared/model";
import type {
  OrchestrationLatestTurn,
  OrchestrationMessageRichText,
  OrchestrationProposedPlanId,
  OrchestrationSessionStatus,
  OrchestrationThreadActivity,
  OrchestrationThreadEntry,
  ThreadEntryId,
  TurnId,
  MessageId,
  RuntimeMode,
} from "@honk/contracts";
import type { ProjectScript as ContractProjectScript } from "@honk/shared/project-scripts";
import type { ThreadId, ProjectId } from "@honk/shared/base-schemas";
import type { AgentInteractionMode } from "@honk/shared/interaction-mode";

export type SessionPhase = "disconnected" | "connecting" | "ready" | "running";
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export const DEFAULT_INTERACTION_MODE: AgentInteractionMode = "agent";
export type ProjectScript = ContractProjectScript;

export interface ChatImageAttachment {
  type: "image";
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl?: string;
}

export type ChatAttachment = ChatImageAttachment;

export interface ChatMessage {
  id: MessageId;
  role: "user" | "assistant" | "system";
  text: string;
  richText?: OrchestrationMessageRichText | undefined;
  attachments?: ChatAttachment[];
  turnId?: TurnId | null;
  createdAt: string;
  completedAt?: string | undefined;
  streaming: boolean;
  turnFailure?: string | undefined;
}

export interface LiveAssistantTurn {
  turnId: TurnId;
  messageId: MessageId;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadSendIntent {
  clientMessageId: MessageId;
  parentEntryId: ThreadEntryId | null;
  text: string;
  richText?: OrchestrationMessageRichText | undefined;
  attachments?: ChatAttachment[] | undefined;
  createdAt: string;
}

export type ThreadTreeEntry = OrchestrationThreadEntry;

export interface ProposedPlan {
  id: OrchestrationProposedPlanId;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
  createdAt: string;
  updatedAt: string;
}

export interface TurnDiffFileChange {
  path: string;
  kind?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
}

export interface TurnDiffSummary {
  turnId: TurnId;
  completedAt: string;
  status?: string | undefined;
  files: TurnDiffFileChange[];
  assistantMessageId?: MessageId | undefined;
}

export interface Project {
  id: ProjectId;
  environmentId: EnvironmentId;
  name: string;
  cwd: string;
  repositoryIdentity?: RepositoryIdentity | null;
  defaultModelSelection: ModelSelection | null;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  scripts: ProjectScript[];
}

export interface Thread {
  id: ThreadId;
  environmentId: EnvironmentId;
  codexThreadId: string | null;
  projectId: ProjectId | null;
  title: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: AgentInteractionMode;
  session: ThreadSession | null;
  messages: ChatMessage[];
  leafId: OrchestrationThreadEntry["id"] | null;
  entries: ThreadTreeEntry[];
  proposedPlans: ProposedPlan[];
  error: string | null;
  createdAt: string;
  archivedAt: string | null;
  updatedAt?: string | undefined;
  latestTurn: OrchestrationLatestTurn | null;
  pendingSourceProposedPlan?: OrchestrationLatestTurn["sourceProposedPlan"];
  branch: string | null;
  worktreePath: string | null;
  turnDiffSummaries: TurnDiffSummary[];
  activities: OrchestrationThreadActivity[];
}

export interface ThreadShell {
  id: ThreadId;
  environmentId: EnvironmentId;
  codexThreadId: string | null;
  projectId: ProjectId | null;
  title: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: AgentInteractionMode;
  error: string | null;
  createdAt: string;
  archivedAt: string | null;
  updatedAt?: string | undefined;
  branch: string | null;
  worktreePath: string | null;
}

export interface ThreadTurnState {
  latestTurn: OrchestrationLatestTurn | null;
  pendingSourceProposedPlan?: OrchestrationLatestTurn["sourceProposedPlan"];
}

export interface SidebarThreadSummary {
  id: ThreadId;
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  title: string;
  interactionMode: AgentInteractionMode;
  session: ThreadSession | null;
  createdAt: string;
  archivedAt: string | null;
  updatedAt?: string | undefined;
  latestTurn: OrchestrationLatestTurn | null;
  branch: string | null;
  worktreePath: string | null;
  latestUserMessageAt: string | null;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
  hasActionableProposedPlan: boolean;
}

export interface ThreadSession {
  status: SessionPhase | "error" | "closed";
  activeTurnId?: TurnId | undefined;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  orchestrationStatus: OrchestrationSessionStatus;
}
