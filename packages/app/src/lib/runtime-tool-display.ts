import type { RuntimeDisplayTimelineToolDisplay } from "@multi/contracts";

export const MAX_RUNTIME_SUBAGENT_VISIBLE_ACTIVITIES = 80;
type RuntimeSubagentDisplay = Extract<
  RuntimeDisplayTimelineToolDisplay,
  { kind: "subagent" }
>;
type RuntimeSubagentActivity = RuntimeSubagentDisplay["activities"][number];

export function runtimeToolDisplaySignature(
  display: RuntimeDisplayTimelineToolDisplay | undefined,
): string {
  if (!display) {
    return "";
  }
  switch (display.kind) {
    case "shell":
      return [
        display.kind,
        display.command ?? "",
        display.output ?? "",
        display.exitCode ?? "",
      ].join("\u0000");
    case "read":
      return [
        display.kind,
        display.path ?? "",
        display.output ?? "",
        display.startLine ?? "",
        display.endLine ?? "",
      ].join("\u0000");
    case "grep":
      return [
        display.kind,
        display.query ?? "",
        display.path ?? "",
        display.output ?? "",
        ...(display.matchedFiles ?? []),
      ].join("\u0000");
    case "edit":
      return [
        display.kind,
        display.path ?? "",
        display.output ?? "",
        display.additions ?? "",
        display.deletions ?? "",
      ].join("\u0000");
    case "mcp":
      return [display.kind, display.providerIdentifier ?? ""].join("\u0000");
    case "subagent":
      return [
        display.kind,
        display.mode,
        display.agentScope,
        display.projectAgentsDir ?? "",
        ...display.runs.map((run) =>
          [
            run.subagentThreadId,
            run.agentId,
            run.nickname,
            run.role,
            run.model ?? "",
            run.prompt,
            run.state,
            run.finalText ?? "",
            run.errorMessage ?? "",
          ].join("\u0001"),
        ),
        ...recentSubagentSignatureActivities(display).map(subagentActivitySignature),
      ].join("\u0000");
    case "unknown":
      return [display.kind, display.toolName, display.output ?? ""].join("\u0000");
  }
}

function recentSubagentSignatureActivities(
  display: RuntimeSubagentDisplay,
): RuntimeSubagentActivity[] {
  const runThreadIds = new Set(display.runs.map((run) => run.subagentThreadId));
  if (runThreadIds.size === 0 || display.activities.length === 0) {
    return [];
  }

  const retainedActivities: RuntimeSubagentActivity[] = [];
  const retainedCountByThreadId = new Map<string, number>();
  const cappedThreadIds = new Set<string>();
  for (let index = display.activities.length - 1; index >= 0; index -= 1) {
    const activity = display.activities[index];
    if (!activity || !runThreadIds.has(activity.payload.subagentThreadId)) {
      continue;
    }
    const retainedCount = retainedCountByThreadId.get(activity.payload.subagentThreadId) ?? 0;
    if (retainedCount >= MAX_RUNTIME_SUBAGENT_VISIBLE_ACTIVITIES) {
      continue;
    }
    retainedActivities.push(activity);
    const nextRetainedCount = retainedCount + 1;
    retainedCountByThreadId.set(activity.payload.subagentThreadId, nextRetainedCount);
    if (nextRetainedCount >= MAX_RUNTIME_SUBAGENT_VISIBLE_ACTIVITIES) {
      cappedThreadIds.add(activity.payload.subagentThreadId);
    }
    if (cappedThreadIds.size === runThreadIds.size) {
      break;
    }
  }
  return retainedActivities.toReversed();
}

function subagentActivitySignature(activity: RuntimeSubagentActivity): string {
  return [
    activity.id,
    activity.kind,
    activity.tone,
    activity.summary,
    activity.createdAt,
    activity.sequence,
    activity.payload.subagentThreadId,
    activity.payload.state ?? "",
    activity.payload.status ?? "",
    activity.payload.title ?? "",
    activity.payload.detail ?? "",
    activity.payload.itemType ?? "",
    activity.payload.itemId ?? "",
  ].join("\u0001");
}
