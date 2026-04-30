/**
 * UI session types (formerly in @multi/contracts).
 *
 * Types that already exist in @multi/contracts (ProviderKind, ThreadId,
 * ModelSelection, ProviderInteractionMode, etc.) are NOT duplicated here --
 * import those directly from @multi/contracts.
 */

// ── Primitive ────────────────────────────────────────────────────────

export type Json = null | boolean | number | string | Json[] | { readonly [k: string]: Json };

// ── Blocks ───────────────────────────────────────────────────────────

export interface UiTextBlock {
  type: "text";
  text: string;
}

export interface UiThinkingBlock {
  type: "thinking";
  thinking: string;
  summary?: string;
}

export interface UiImageBlock {
  type: "image";
  mimeType?: string;
  data?: string;
}

export interface UiToolCallBlock {
  type: "toolCall";
  id?: string;
  name: string;
  arguments?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UiUnknownBlock {
  type: string;
  [key: string]: unknown;
}

export type UiBlock =
  | UiTextBlock
  | UiThinkingBlock
  | UiImageBlock
  | UiToolCallBlock
  | UiUnknownBlock;

// ── Prompt ───────────────────────────────────────────────────────────

export interface UiPromptPathAttachment {
  type: "path";
  path: string;
  name?: string;
}

export interface UiPromptInlineAttachment {
  type: "inline";
  name: string;
  mimeType: string;
  data: string;
}

export type UiPromptAttachment = UiPromptPathAttachment | UiPromptInlineAttachment;

export interface UiPromptInput {
  text: string;
  attachments?: UiPromptAttachment[];
}

// ── Messages ─────────────────────────────────────────────────────────

export interface UiUserMessage {
  role: "user";
  content: string | UiBlock[];
}

export interface UiUserAttachmentMessage {
  role: "user-with-attachments";
  content: string | UiBlock[];
}

export interface UiAssistantMessage {
  role: "assistant";
  content: UiBlock[];
  stopReason?: string;
  errorMessage?: string;
}

export interface UiToolResultMessage {
  role: "toolResult";
  toolCallId?: string;
  content: UiBlock[];
  toolName?: string;
  isError?: boolean;
  details?: Record<string, unknown>;
}

export interface UiBashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode?: number;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
  excludeFromContext?: boolean;
}

export interface UiCustomMessage {
  role: "custom";
  customType: string;
  content: string | UiBlock[];
  display: boolean;
  details?: unknown;
}

export interface UiBranchSummaryMessage {
  role: "branchSummary";
  summary: string;
  fromId: string;
}

export interface UiCompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;
  tokensBefore: number;
}

export interface UiSystemMessage {
  role: "system";
  content: string | UiBlock[];
}

export interface UiUnknownMessage {
  role: string;
  [key: string]: unknown;
}

export type UiMessage =
  | UiUserMessage
  | UiUserAttachmentMessage
  | UiAssistantMessage
  | UiToolResultMessage
  | UiBashExecutionMessage
  | UiCustomMessage
  | UiBranchSummaryMessage
  | UiCompactionSummaryMessage
  | UiSystemMessage
  | UiUnknownMessage;

// ── Session ──────────────────────────────────────────────────────────

export interface UiSessionItem {
  id: string;
  createdAt: string;
  message: UiMessage;
}

export interface SessionListSummary {
  id: string;
  harness?: HarnessKind;
  path: string;
  cwd: string;
  name: string | null;
  createdAt: string;
  modifiedAt: string;
  messageCount: number;
  firstMessage: string;
  allMessagesText: string;
  isStreaming: boolean;
}

export interface UiSessionPending {
  steering: string[];
  followUp: string[];
}

export type UiSessionActiveEvent = Record<string, unknown>;

export interface UiSessionSnapshot {
  id: string;
  harness?: HarnessKind;
  file: string | null;
  cwd: string;
  name: string | null;
  model: HarnessModelRef | null;
  thinkingLevel: ThinkingLevel;
  messages: UiSessionItem[];
  live: UiSessionItem | null;
  working: UiWorkingState | null;
  isStreaming: boolean;
  pending: UiSessionPending;
}

// ── Working state ────────────────────────────────────────────────────

export interface UiWorkingTool {
  itemId: string;
  title: string | null;
  detail: string | null;
}

export interface UiWorkingTask {
  id: string;
  description: string | null;
  summary: string | null;
}

export type UiWorkingStatus = "running" | "interrupted" | "error";

export interface UiWorkingState {
  threadId: string;
  turnId: string | null;
  provider: string;
  status: UiWorkingStatus;
  startedAt: string | null;
  updatedAt: string;
  summary: string | null;
  text: string;
  tool: UiWorkingTool | null;
  task: UiWorkingTask | null;
}

export interface UiWorkingUpdate {
  threadId: string;
  working: UiWorkingState | null;
}

// ── Ask ──────────────────────────────────────────────────────────────

export type ThreadInteractiveKind = "select" | "confirm" | "input" | "editor";

export interface UiAskOption {
  id: string;
  label: string;
  shortcut?: string;
  recommended?: boolean;
  other?: boolean;
}

export interface UiAskQuestion {
  id: string;
  text: string;
  options: UiAskOption[];
  multi?: boolean;
  optional?: boolean;
}

export interface UiAskState {
  sessionId: string;
  toolCallId: string;
  kind: ThreadInteractiveKind;
  questions: UiAskQuestion[];
  current: number;
  values: Record<string, string[]>;
  custom: Record<string, string>;
}

export type UiAskReply =
  | { type: "next"; questionId: string; values: string[]; custom?: string }
  | { type: "back"; questionId: string; values: string[]; custom?: string }
  | { type: "skip"; questionId: string; values?: string[]; custom?: string }
  | { type: "abort" };

// ── Harness ──────────────────────────────────────────────────────────

export type HarnessKind = "codex" | "claudeCode";

export interface HarnessModelRef {
  provider: string;
  id: string;
  name?: string | null;
  reasoning?: boolean;
}

export interface HarnessCapabilities {
  modelPicker: boolean;
  thinkingLevels: boolean;
  commands: boolean;
  interactive: boolean;
  fileAttachments: boolean;
}

export interface HarnessDescriptor {
  kind: HarnessKind;
  label: string;
  version?: string;
  available: boolean;
  enabled: boolean;
  reason?: string;
  capabilities: HarnessCapabilities;
}

// ── Thinking ─────────────────────────────────────────────────────────

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

// ── Shell / file search ──────────────────────────────────────────────

export type ShellFileKind = "file" | "dir" | "image";

export interface ShellFileHit {
  path: string;
  name: string;
  kind: ShellFileKind;
}

export interface ShellFilePreview {
  path: string;
  kind: "text" | "image";
  text?: string;
  truncated?: boolean;
  mimeType?: string | null;
  data?: string;
}

// ── Skills ───────────────────────────────────────────────────────────

export interface UiSkill {
  id: string;
  name: string;
  description?: string;
  body: string;
}

// ── Git (Glass-specific shapes, not in @multi/contracts) ───────────

export type GitFileState =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "ignored"
  | "conflict";

export interface GitFileSummary {
  id: string;
  path: string;
  prevPath: string | null;
  state: GitFileState;
  staged: boolean;
  insertions: number;
  deletions: number;
}

export interface GitState {
  cwd: string;
  gitRoot: string | null;
  repo: boolean;
  clean: boolean;
  count: number;
  branch: string | null;
  remote: string | null;
  ahead: number;
  behind: number;
  files: GitFileSummary[];
}

// ── Provider notice ──────────────────────────────────────────────────

export const PROVIDER_NOTICE_KIND = {
  rateLimit: "provider.notice.rate-limit",
  auth: "provider.notice.auth",
  config: "provider.notice.config",
} as const;

export type ProviderNoticeKind = (typeof PROVIDER_NOTICE_KIND)[keyof typeof PROVIDER_NOTICE_KIND];

export const PROVIDER_NOTICE_KINDS = Object.values(PROVIDER_NOTICE_KIND);
