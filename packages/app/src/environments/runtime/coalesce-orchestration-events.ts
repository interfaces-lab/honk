import { type OrchestrationEvent, type OrchestrationThreadActivity } from "@multi/contracts";

type ThreadActivityAppendedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.activity-appended" }
>;

type SubagentContentDeltaActivity = Extract<
  OrchestrationThreadActivity,
  { kind: "subagent.content.delta" }
>;

type ToolLifecycleActivity = Extract<
  OrchestrationThreadActivity,
  { kind: "tool.started" | "tool.updated" | "tool.completed" }
>;

type SubagentItemLifecycleActivity = Extract<
  OrchestrationThreadActivity,
  { kind: "subagent.item.started" | "subagent.item.updated" | "subagent.item.completed" }
>;

/**
 * Activity bursts with a stable runtime key are reduced to the latest visible
 * row state while preserving raw events for side effects.
 */
export function coalesceOrchestrationUiEvents(
  events: ReadonlyArray<OrchestrationEvent>,
): OrchestrationEvent[] {
  if (events.length < 2) {
    return [...events];
  }

  const coalesced: OrchestrationEvent[] = [];
  const activityIndexesByStableKey = new Map<string, number>();
  for (const event of events) {
    if (event.type === "thread.activity-appended") {
      const key = stableActivityUiKey(event);
      if (key) {
        const existingIndex = activityIndexesByStableKey.get(key);
        if (existingIndex !== undefined) {
          const existing = coalesced[existingIndex];
          if (existing?.type === "thread.activity-appended") {
            coalesced[existingIndex] = mergeThreadActivityAppendedEvent(existing, event);
            continue;
          }
        }
        activityIndexesByStableKey.set(key, coalesced.length);
      } else {
        activityIndexesByStableKey.clear();
      }
    } else {
      activityIndexesByStableKey.clear();
    }

    coalesced.push(event);
  }

  return coalesced;
}

function stableActivityUiKey(event: ThreadActivityAppendedEvent): string | null {
  const activity = event.payload.activity;
  switch (activity.kind) {
    case "tool.started":
    case "tool.updated":
    case "tool.completed": {
      const itemId = activity.payload.itemId;
      if (!itemId) {
        return null;
      }
      const streamKind = toolOutputStreamKind(activity);
      return streamKind
        ? [event.payload.threadId, "tool-output", itemId, streamKind].join("\u001f")
        : [event.payload.threadId, "tool", itemId].join("\u001f");
    }
    case "subagent.content.delta": {
      const subagentThreadId = activity.payload.subagentThreadId;
      const itemId = activity.payload.itemId;
      if (!subagentThreadId || !itemId) {
        return null;
      }
      return [
        event.payload.threadId,
        "subagent-delta",
        subagentThreadId,
        itemId,
        activity.payload.streamKind,
        activity.payload.contentIndex ?? "",
        activity.payload.summaryIndex ?? "",
      ].join("\u001f");
    }
    case "subagent.item.started":
    case "subagent.item.updated":
    case "subagent.item.completed": {
      const subagentThreadId = activity.payload.subagentThreadId;
      const itemId = activity.payload.itemId;
      if (!subagentThreadId || !itemId) {
        return null;
      }
      return [event.payload.threadId, "subagent-item", subagentThreadId, itemId].join("\u001f");
    }
    default:
      return null;
  }
}

function mergeThreadActivityAppendedEvent(
  previous: ThreadActivityAppendedEvent,
  next: ThreadActivityAppendedEvent,
): ThreadActivityAppendedEvent {
  const previousActivity = previous.payload.activity;
  const nextActivity = next.payload.activity;
  if (
    previousActivity.kind === "subagent.content.delta" &&
    nextActivity.kind === "subagent.content.delta"
  ) {
    return {
      ...next,
      payload: {
        ...next.payload,
        activity: mergeSubagentContentDeltaActivity(previousActivity, nextActivity),
      },
    };
  }

  if (isToolLifecycleActivity(previousActivity) && isToolLifecycleActivity(nextActivity)) {
    return {
      ...next,
      payload: {
        ...next.payload,
        activity: mergeToolLifecycleActivity(previousActivity, nextActivity),
      },
    };
  }

  if (
    isSubagentItemLifecycleActivity(previousActivity) &&
    isSubagentItemLifecycleActivity(nextActivity)
  ) {
    return {
      ...next,
      payload: {
        ...next.payload,
        activity: mergeSubagentItemLifecycleActivity(previousActivity, nextActivity),
      },
    };
  }

  return next;
}

function isToolLifecycleActivity(
  activity: OrchestrationThreadActivity,
): activity is ToolLifecycleActivity {
  return (
    activity.kind === "tool.started" ||
    activity.kind === "tool.updated" ||
    activity.kind === "tool.completed"
  );
}

function isSubagentItemLifecycleActivity(
  activity: OrchestrationThreadActivity,
): activity is SubagentItemLifecycleActivity {
  return (
    activity.kind === "subagent.item.started" ||
    activity.kind === "subagent.item.updated" ||
    activity.kind === "subagent.item.completed"
  );
}

function mergeSubagentItemLifecycleActivity(
  previous: SubagentItemLifecycleActivity,
  next: SubagentItemLifecycleActivity,
): SubagentItemLifecycleActivity {
  return {
    ...next,
    createdAt: previous.createdAt,
    ...(previous.sequence !== undefined ? { sequence: previous.sequence } : {}),
    payload: {
      ...previous.payload,
      ...next.payload,
    },
  };
}

function mergeToolLifecycleActivity(
  previous: ToolLifecycleActivity,
  next: ToolLifecycleActivity,
): ToolLifecycleActivity {
  const previousStreamKind = toolOutputStreamKind(previous);
  const nextStreamKind = toolOutputStreamKind(next);
  if (previousStreamKind && previousStreamKind === nextStreamKind) {
    return mergeToolOutputStreamActivity(previous, next, previousStreamKind);
  }

  return {
    ...next,
    createdAt: previous.createdAt,
    ...(previous.sequence !== undefined ? { sequence: previous.sequence } : {}),
    payload: {
      ...previous.payload,
      ...next.payload,
    },
  };
}

function mergeToolOutputStreamActivity(
  previous: ToolLifecycleActivity,
  next: ToolLifecycleActivity,
  streamKind: "command_output" | "file_change_output",
): ToolLifecycleActivity {
  const detail = mergeText(
    stringPayloadField(previous.payload.detail),
    stringPayloadField(next.payload.detail),
  );
  const previousData = recordPayloadField(previous.payload.data);
  const nextData = recordPayloadField(next.payload.data);
  const delta = mergeText(
    stringPayloadField(previousData?.delta),
    stringPayloadField(nextData?.delta),
  );
  return {
    ...next,
    createdAt: previous.createdAt,
    ...(previous.sequence !== undefined ? { sequence: previous.sequence } : {}),
    payload: {
      ...previous.payload,
      ...next.payload,
      ...(detail ? { detail } : {}),
      data: {
        ...previousData,
        ...nextData,
        streamKind,
        ...(delta ? { delta } : {}),
      },
    },
  };
}

function toolOutputStreamKind(
  activity: ToolLifecycleActivity,
): "command_output" | "file_change_output" | null {
  const data = recordPayloadField(activity.payload.data);
  const streamKind = stringPayloadField(data?.streamKind);
  return streamKind === "command_output" || streamKind === "file_change_output" ? streamKind : null;
}

function mergeText(previous: string | undefined, next: string | undefined): string | undefined {
  if (!previous) {
    return next;
  }
  if (!next || next === previous) {
    return previous;
  }
  if (next.startsWith(previous)) {
    return next;
  }
  if (previous.endsWith(next)) {
    return previous;
  }
  return `${previous}${next}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordPayloadField(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined;
}

function stringPayloadField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mergeSubagentContentDeltaActivity(
  previous: SubagentContentDeltaActivity,
  next: SubagentContentDeltaActivity,
): SubagentContentDeltaActivity {
  return {
    ...next,
    createdAt: previous.createdAt,
    ...(previous.sequence !== undefined ? { sequence: previous.sequence } : {}),
    payload: {
      ...next.payload,
      delta: previous.payload.delta + next.payload.delta,
    },
  };
}
