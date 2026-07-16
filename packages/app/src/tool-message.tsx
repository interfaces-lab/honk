import * as stylex from "@stylexjs/stylex";
import type { Part } from "@honk/opencode";
import { ToolCallLine, WorkGroup, type ToolCallState } from "@honk/ui";
import { colorVars, conversationVars, fontVars, radiusVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { taskToolControlID, taskToolRegionID } from "./thread/subagent-session";
import { toolArtifactCanExpand, ToolArtifactPreview } from "./tool-artifact";
import type { ToolPart } from "./tool-part-projection";
import { toolVerb, toolView } from "./tool-presentation";

type FilePart = Extract<Part, { readonly type: "file" }>;
// Tool media stays in the transcript. It does not open a workbench surface.
const TOOL_IMAGE_MAX_WIDTH = "240px";
const TOOL_IMAGE_MAX_HEIGHT = "160px";
const ATTACHMENT_RING = `inset 0 0 0 1px ${colorVars["--honk-color-border-base"]}`;

const styles = stylex.create({
  attachments: {
    display: "flex",
    flexWrap: "wrap",
    gap: conversationVars["--honk-conversation-step-gap"],
    paddingInline: conversationVars["--honk-conversation-inset"],
  },
  attachmentImage: {
    display: "block",
    maxWidth: TOOL_IMAGE_MAX_WIDTH,
    maxHeight: TOOL_IMAGE_MAX_HEIGHT,
    borderRadius: radiusVars["--honk-radius-control"],
    boxShadow: ATTACHMENT_RING,
    objectFit: "cover",
  },
  attachmentLink: {
    display: "inline-flex",
    minWidth: 0,
    maxWidth: TOOL_IMAGE_MAX_WIDTH,
    paddingBlock: conversationVars["--honk-conversation-row-gap"],
    paddingInline: conversationVars["--honk-conversation-step-gap"],
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    color: colorVars["--honk-color-fg-secondary"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-text-title"],
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

function ToolMessage({
  part,
  allowDisclosure = true,
  defaultExpanded = false,
  onOpenTask,
  taskSelected = false,
  stateOverride,
}: {
  readonly part: ToolPart;
  readonly allowDisclosure?: boolean;
  readonly defaultExpanded?: boolean;
  readonly onOpenTask?: ((part: ToolPart) => void) | undefined;
  readonly taskSelected?: boolean;
  readonly stateOverride?: ToolCallState | undefined;
}): React.ReactElement {
  const [isExpanded, setExpanded] = React.useState(
    () =>
      defaultExpanded ||
      part.tool === "question" ||
      part.tool === "todowrite" ||
      part.tool === "todoread",
  );
  const view = toolView(part);
  const displayState = stateOverride ?? view.state;
  const displayVerb = stateOverride === undefined ? view.verb : toolVerb(part, displayState);
  const isTask = part.tool === "task";
  const taskHasError = isTask && part.state.status === "error";
  const hasBody =
    (!isTask || taskHasError) &&
    view.artifact === undefined &&
    view.body !== undefined &&
    view.body.length > 0;
  const attachments = part.state.status === "completed" ? (part.state.attachments ?? []) : [];
  const artifactCanExpand = view.artifact !== undefined && toolArtifactCanExpand(view.artifact);
  const canExpand = allowDisclosure && (artifactCanExpand || hasBody || attachments.length > 0);
  const canOpenTask = isTask && !taskHasError && onOpenTask !== undefined;
  const rowExpanded = canOpenTask ? taskSelected : isExpanded;

  return (
    <>
      <ToolCallLine
        {...(canOpenTask
          ? {
              id: taskToolControlID(part.id),
              "aria-controls": taskToolRegionID(part.id),
              "aria-label": `${displayVerb}${view.detail === undefined ? "" : ` ${view.detail}`}${displayState === "failed" ? ", failed" : ""}. ${taskSelected ? "Minimize" : "Open"} current subagent preview`,
            }
          : {})}
        verb={displayVerb}
        detail={view.detail}
        state={displayState}
        added={view.added}
        removed={view.removed}
        isExpanded={rowExpanded}
        onToggle={
          canOpenTask
            ? () => {
                onOpenTask(part);
              }
            : canExpand
              ? () => {
                  setExpanded((current) => !current);
                }
              : undefined
        }
      />
      {canOpenTask || !allowDisclosure || view.artifact === undefined ? null : (
        <ToolArtifactPreview artifact={view.artifact} isExpanded={isExpanded} />
      )}
      {canExpand && isExpanded && hasBody ? (
        <WorkGroup.OutputStrip>{view.body}</WorkGroup.OutputStrip>
      ) : null}
      {canExpand && isExpanded && attachments.length > 0 ? (
        <ToolAttachments attachments={attachments} />
      ) : null}
    </>
  );
}

function ToolAttachments({
  attachments,
}: {
  readonly attachments: readonly FilePart[];
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.attachments)}>
      {attachments.map((attachment) => {
        const name = attachment.filename ?? fileUrlBasename(attachment.url);
        return attachment.mime.startsWith("image/") ? (
          <img
            key={attachment.id}
            src={attachment.url}
            alt={name}
            {...stylex.props(styles.attachmentImage)}
          />
        ) : (
          <a key={attachment.id} href={attachment.url} {...stylex.props(styles.attachmentLink)}>
            {name}
          </a>
        );
      })}
    </div>
  );
}

function fileUrlBasename(url: string): string {
  if (url.startsWith("data:")) {
    return "attachment";
  }
  const trimmed = url.replace(/^file:\/\//, "").replace(/[\\/]+$/, "");
  const [last = trimmed] = trimmed.split(/[\\/]/).slice(-1);
  return last.length > 0 ? last : url;
}

export { ToolMessage };
