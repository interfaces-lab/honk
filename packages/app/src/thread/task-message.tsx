import { openCodeSessionRef, type OpenCodeServerKey } from "@honk/opencode";
import { honkPresetAgentByName } from "@honk/opencode/agents";
import { honkPairingForSidekick } from "@honk/opencode/pairing";
import { contractHomeDir } from "@honk/shared/paths";
import {
  Icon,
  PreviewCard,
  Text,
  ToolCallLine,
  WorkGroup,
  type Glyph,
  type ToolCallState,
} from "@honk/ui";
import { IconBranch, IconChip, IconFolder1 } from "@honk/ui/icons";
import { controlVars, conversationVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { useState, type ReactElement } from "react";

import type { AppChildSessionSummary, ThreadViewState } from "../open-code-view";
import { modelLabel } from "../presets";
import { useServerHome } from "../tab-store";
import { toolDetail, toolVerb, toolView } from "../tool-presentation";
import { useSessionWatch } from "../use-sdk-watch";
import {
  taskAgent,
  taskToolControlID,
  taskToolRegionID,
  type TaskChildLink,
} from "./subagent-session";
import type { ToolPart } from "./transcript-model";
import { threadViewState } from "./view-state";
import { WAITING_PLANNING_LABEL } from "./waiting-status";

const ACTIVITY_MAX_CHARS = 140;
const TASK_PREVIEW_MAX_WIDTH = "20rem";
const NEEDS_YOU_LABEL = "Needs you";

export function TaskMessage(props: {
  readonly part: ToolPart;
  readonly link: TaskChildLink | null;
  readonly isThreadRunning: boolean;
  readonly isOpen: boolean;
  readonly onOpen: ((part: ToolPart) => void) | undefined;
}): ReactElement {
  const [isErrorExpanded, setErrorExpanded] = useState(false);
  const projectedState = props.link?.state ?? toolView(props.part).state;
  const state =
    projectedState === "running" && props.link?.ownsLiveState !== true && !props.isThreadRunning
      ? "done"
      : projectedState;
  const error = props.part.state.status === "error" ? props.part.state.error : null;
  const onToggle =
    props.link !== null && props.onOpen !== undefined
      ? () => {
          props.onOpen?.(props.part);
        }
      : error === null
        ? undefined
        : () => {
            setErrorExpanded((current) => !current);
          };
  const isExpanded = props.link !== null ? props.isOpen : isErrorExpanded;
  const mission = taskMission(props.part, props.link?.child);
  const model = taskModelLabel(props.part, props.link?.child);
  const rowProps = {
    part: props.part,
    mission,
    model,
    state,
    isExpanded,
    onToggle,
    statusGlyphVariant: "working" as const,
    // Stays a status word rather than the live activity so the accessible name does not
    // change on every tool call the child makes.
    statusLabel: state === "done" ? "Completed" : state === "failed" ? "Failed" : "In progress",
    toggleHint:
      props.link !== null
        ? `${props.isOpen ? "Minimize" : "Open"} work details`
        : isErrorExpanded
          ? "Hide failure details"
          : "Show failure details",
  } as const;

  const row =
    state === "running" && props.link?.ownsLiveState === true ? (
      <LiveTaskMessage {...rowProps} child={props.link.child} />
    ) : (
      <TaskMessageRow
        {...rowProps}
        activity={
          state === "done" ? "Completed" : state === "failed" ? "Failed" : WAITING_PLANNING_LABEL
        }
      />
    );

  return (
    <>
      {props.link === null ? (
        row
      ) : (
        <TaskPreviewCard child={props.link.child} mission={mission} model={model}>
          {row}
        </TaskPreviewCard>
      )}
      {error === null || !isErrorExpanded || props.link !== null ? null : (
        <div id={taskToolRegionID(props.part.id)}>
          <WorkGroup.OutputStrip>{error}</WorkGroup.OutputStrip>
        </div>
      )}
    </>
  );
}

// Cursor-style hover preview for a resolved subagent row: the mission title over
// compact branch, directory, and model rows. Only rendered when the row links to a
// child session with at least one metadata detail beyond the row's own text (the
// working directory almost always qualifies). The wrapped row stays fully
// clickable; the card is a read-only hover/focus surface whose popup portals out so
// transcript virtualization can recycle the row. All content derives from props.
function TaskPreviewCard(props: {
  readonly child: AppChildSessionSummary;
  readonly mission: string;
  readonly model: string | null;
  readonly children: ReactElement;
}): ReactElement {
  const branch = props.child.worktree?.branch ?? null;
  const directory = taskDirectory(props.child);
  if (branch === null && directory === null) return props.children;

  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger render={<span {...stylex.props(styles.trigger)} />}>
        {props.children}
      </PreviewCard.Trigger>
      <PreviewCard.Popup>
        <TaskPreviewContent
          server={props.child.server}
          mission={props.mission}
          model={props.model}
          branch={branch}
          directory={directory}
        />
      </PreviewCard.Popup>
    </PreviewCard.Root>
  );
}

function TaskPreviewContent(props: {
  readonly server: OpenCodeServerKey;
  readonly mission: string;
  readonly model: string | null;
  readonly branch: string | null;
  readonly directory: string | null;
}): ReactElement {
  const home = useServerHome(props.server);
  return (
    <div {...stylex.props(styles.card)}>
      <Text as="div" size="sm" weight="semibold" truncate>
        {props.mission}
      </Text>
      <div {...stylex.props(styles.meta)}>
        {props.branch === null ? null : <TaskPreviewRow icon={IconBranch} text={props.branch} />}
        {props.directory === null ? null : (
          <TaskPreviewRow icon={IconFolder1} text={contractHomeDir(props.directory, home)} />
        )}
        {props.model === null ? null : <TaskPreviewRow icon={IconChip} text={props.model} />}
      </div>
    </div>
  );
}

function TaskPreviewRow(props: { readonly icon: Glyph; readonly text: string }): ReactElement {
  return (
    <div {...stylex.props(styles.row)}>
      <Icon icon={props.icon} size="xs" tone="muted" />
      <Text size="xs" tone="muted" truncate>
        {props.text}
      </Text>
    </div>
  );
}

function taskDirectory(child: AppChildSessionSummary): string | null {
  const path = child.worktree?.path ?? child.projectDirectory;
  return path.length > 0 ? path : null;
}

const styles = stylex.create({
  trigger: {
    display: "inline-flex",
    minWidth: 0,
    maxWidth: "100%",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    minWidth: 0,
    maxWidth: TASK_PREVIEW_MAX_WIDTH,
  },
  meta: {
    display: "flex",
    flexDirection: "column",
    gap: conversationVars["--honk-conversation-row-gap"],
    minWidth: 0,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    minWidth: 0,
  },
});

function LiveTaskMessage(
  props: Readonly<{
    part: ToolPart;
    child: AppChildSessionSummary;
    mission: string;
    model: string | null;
    state: ToolCallState;
    statusLabel: string;
    statusGlyphVariant: "working" | "attention";
    toggleHint: string;
    isExpanded: boolean;
    onToggle: (() => void) | undefined;
  }>,
): ReactElement {
  const watch = useSessionWatch(openCodeSessionRef(props.child.server, props.child.id));
  const state = threadViewState(watch.state);
  // A permission or question raised inside the child session can only be answered in its own
  // tray, and opencode's ask never times out. The row has to say the work is blocked on the
  // user rather than let a wedged subagent keep reading as merely working.
  if (state !== null && (state.permissions.length > 0 || state.questions.length > 0)) {
    return (
      <TaskMessageRow
        {...props}
        statusLabel={NEEDS_YOU_LABEL}
        statusGlyphVariant="attention"
        activity={needsYouActivity(state)}
      />
    );
  }
  return (
    <TaskMessageRow
      {...props}
      activity={
        state === null
          ? WAITING_PLANNING_LABEL
          : (latestTaskActivity(state) ?? WAITING_PLANNING_LABEL)
      }
    />
  );
}

function TaskMessageRow(
  props: Readonly<{
    part: ToolPart;
    mission: string;
    model: string | null;
    activity: string;
    state: ToolCallState;
    statusLabel: string;
    statusGlyphVariant: "working" | "attention";
    toggleHint: string;
    isExpanded: boolean;
    onToggle: (() => void) | undefined;
  }>,
): ReactElement {
  return (
    <ToolCallLine
      id={taskToolControlID(props.part.id)}
      verb={props.mission}
      detail={props.model ?? undefined}
      supportingText={props.activity}
      state={props.state}
      isExpanded={props.isExpanded}
      workingGlyph
      statusGlyphVariant={props.statusGlyphVariant}
      {...(props.onToggle === undefined
        ? {}
        : {
            onToggle: props.onToggle,
            "aria-controls": taskToolRegionID(props.part.id),
            "aria-label": `${props.mission}${props.model === null ? "" : `, ${props.model}`}. ${props.statusLabel}. ${props.toggleHint}`,
          })}
    />
  );
}

export function needsYouActivity(
  state: Pick<ThreadViewState, "permissions" | "questions"> | null,
): string {
  const action = state?.permissions[0]?.action;
  if (action !== undefined && action.length > 0) return `${NEEDS_YOU_LABEL} — ${action}`;
  const headers =
    state?.questions.flatMap((request) =>
      request.questions
        .map((question) => question.header.trim())
        .filter((header) => header.length > 0),
    ) ?? [];
  return headers.length > 0 ? `${NEEDS_YOU_LABEL} — ${headers.join(", ")}` : NEEDS_YOU_LABEL;
}

export function latestTaskActivity(
  state: Pick<ThreadViewState, "messages" | "parts">,
): string | null {
  const assistantMessageIDs = new Set(
    state.messages.filter((message) => message.role === "assistant").map((message) => message.id),
  );
  const message = state.parts.findLast(
    (part) =>
      assistantMessageIDs.has(part.messageID) &&
      part.type === "text" &&
      part.synthetic !== true &&
      part.ignored !== true &&
      part.text.trim().length > 0,
  );
  if (message !== undefined && message.type === "text") return compactActivity(message.text);

  const tool = state.parts.findLast(
    (part): part is ToolPart => assistantMessageIDs.has(part.messageID) && part.type === "tool",
  );
  if (tool === undefined) return null;
  const detail = toolDetail(tool);
  return compactActivity(
    `${tool.tool === "task" ? "Coordinating" : toolVerb(tool)}${detail === undefined ? "" : ` ${detail}`}`,
  );
}

export function taskMission(part: ToolPart, child: AppChildSessionSummary | undefined): string {
  return toolDetail(part) ?? child?.title ?? "Background work";
}

export function taskModelLabel(
  part: ToolPart,
  child: AppChildSessionSummary | undefined,
): string | null {
  const agent = child?.agent ?? taskAgent(part) ?? undefined;
  const pairing = honkPairingForSidekick(agent);
  if (pairing !== undefined) return modelLabel(pairing.sidekick);
  const preset = honkPresetAgentByName(agent);
  return preset === undefined ? null : `${preset.label} · ${modelLabel(preset.model)}`;
}

function compactActivity(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= ACTIVITY_MAX_CHARS
    ? compact
    : `${compact.slice(0, ACTIVITY_MAX_CHARS)}…`;
}
