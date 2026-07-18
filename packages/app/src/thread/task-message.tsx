import { openCodeSessionRef } from "@honk/opencode";
import { honkPairingForSidekick } from "@honk/opencode/pairing";
import { ToolCallLine, WorkGroup, type ToolCallState } from "@honk/ui";
import { useState, type ReactElement } from "react";

import type { AppChildSessionSummary, ThreadViewState } from "../open-code-view";
import { modelLabel } from "../presets";
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

export function TaskMessage(props: {
  readonly part: ToolPart;
  readonly link: TaskChildLink | null;
  readonly isOpen: boolean;
  readonly onOpen: ((part: ToolPart) => void) | undefined;
}): ReactElement {
  const [isErrorExpanded, setErrorExpanded] = useState(false);
  const state = props.link?.state ?? toolView(props.part).state;
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
    ariaLabel:
      onToggle === undefined
        ? undefined
        : `${mission}${model === null ? "" : `, ${model}`}. ${state === "done" ? "Completed" : state === "failed" ? "Failed" : "In progress"}. ${props.link !== null ? (props.isOpen ? "Minimize" : "Open") + " work details" : isErrorExpanded ? "Hide failure details" : "Show failure details"}`,
  } as const;

  return (
    <>
      {state === "running" && props.link?.ownsLiveState === true ? (
        <LiveTaskMessage {...rowProps} child={props.link.child} />
      ) : (
        <TaskMessageRow
          {...rowProps}
          activity={
            state === "done" ? "Completed" : state === "failed" ? "Failed" : WAITING_PLANNING_LABEL
          }
        />
      )}
      {error === null || !isErrorExpanded || props.link !== null ? null : (
        <div id={taskToolRegionID(props.part.id)}>
          <WorkGroup.OutputStrip>{error}</WorkGroup.OutputStrip>
        </div>
      )}
    </>
  );
}

function LiveTaskMessage(
  props: Readonly<{
    part: ToolPart;
    child: AppChildSessionSummary;
    mission: string;
    model: string | null;
    state: ToolCallState;
    isExpanded: boolean;
    onToggle: (() => void) | undefined;
    ariaLabel: string | undefined;
  }>,
): ReactElement {
  const watch = useSessionWatch(openCodeSessionRef(props.child.server, props.child.id));
  const state = threadViewState(watch.state);
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
    isExpanded: boolean;
    onToggle: (() => void) | undefined;
    ariaLabel: string | undefined;
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
      {...(props.onToggle === undefined
        ? {}
        : {
            onToggle: props.onToggle,
            "aria-controls": taskToolRegionID(props.part.id),
            "aria-label": props.ariaLabel,
          })}
    />
  );
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
  const pairing = honkPairingForSidekick(child?.agent ?? taskAgent(part) ?? undefined);
  return pairing === undefined ? null : modelLabel(pairing.sidekick);
}

function compactActivity(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= ACTIVITY_MAX_CHARS
    ? compact
    : `${compact.slice(0, ACTIVITY_MAX_CHARS)}…`;
}
