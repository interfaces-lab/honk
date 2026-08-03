// Fusion-main lifecycle tools over the paired sidekick session: status peeks at the
// sidekick's transcript tail without interrupting it, stop aborts its in-flight turn
// while keeping the session (and its cached context) resumable.

import { honkPairingForFusionAgent, honkSidekickAgentName } from "./pairing";
import type { PluginInput, ToolContext, ToolDefinition, ToolResult } from "./types";

const STATUS_OUTPUT_LIMIT = 8_000;
const STATUS_PART_LIMIT = 600;
const STATUS_TAIL_LINES = 12;

export type SidekickSessionResolver = (
  parentSessionID: string,
  sidekick: string,
) => Promise<string | undefined>;

export function createSidekickTools(
  plugin: PluginInput,
  resolveSidekickSession: SidekickSessionResolver,
): Readonly<Record<string, ToolDefinition>> {
  return {
    sidekick_status: {
      description:
        "Reads the paired sidekick session's recent activity: whether a tool call is in flight and the tail of its transcript. Use it to monitor a background task without interrupting it.",
      args: {},
      async execute(args, context): Promise<ToolResult> {
        const sessionID = await requireSidekickSession(resolveSidekickSession, context);
        const result = await plugin.client.session.messages({
          path: { id: sessionID },
          query: { directory: plugin.directory },
        });
        if (result.data === undefined) {
          throw new Error("honk: failed to read the sidekick session transcript.");
        }

        const parts = result.data.flatMap((group) =>
          group.parts.map((part) => ({ role: group.info.role, part })),
        );
        const lines = parts
          .map((entry) => {
            const line = partLine(entry.part);
            return line === null ? null : `${entry.role}: ${line}`;
          })
          .filter((line): line is string => line !== null);
        const lastToolState = [...parts].reverse().find((entry) => entry.part.type === "tool")
          ?.part.state;
        const status =
          typeof lastToolState === "object" && lastToolState !== null
            ? Reflect.get(lastToolState, "status")
            : undefined;
        const busy = status === "running" || status === "pending";
        const summary = busy
          ? "The sidekick is mid-turn: its latest tool call has not finished."
          : "No tool call is in flight; the sidekick is idle or has finished its last turn.";
        return {
          title: "Sidekick status",
          output: clipped(
            [summary, "", ...lines.slice(-STATUS_TAIL_LINES)].join("\n"),
            STATUS_OUTPUT_LIMIT,
          ),
          metadata: { sessionID, busy },
        };
      },
    },
    sidekick_stop: {
      description:
        "Aborts the paired sidekick's in-flight turn. The session and its cached context survive; the next task call resumes it.",
      args: {},
      async execute(args, context): Promise<ToolResult> {
        const sessionID = await requireSidekickSession(resolveSidekickSession, context);
        const result = await plugin.client.session.abort({
          path: { id: sessionID },
          query: { directory: plugin.directory },
        });
        if (result.data !== true) {
          throw new Error("honk: the sidekick session did not acknowledge the interrupt.");
        }
        return {
          title: "Sidekick interrupted",
          output: `Aborted the in-flight turn of sidekick session ${sessionID}. The session and its context survive: the next task call resumes it, or pass task_id: "new" to abandon it.`,
          metadata: { sessionID },
        };
      },
    },
  };
}

async function requireSidekickSession(
  resolveSidekickSession: SidekickSessionResolver,
  context: ToolContext,
): Promise<string> {
  const pairing = honkPairingForFusionAgent(context.agent);
  if (pairing === undefined) {
    throw new Error("honk: sidekick tools are only available to a Fusion build main.");
  }
  const sessionID = await resolveSidekickSession(
    context.sessionID,
    honkSidekickAgentName(pairing.stop),
  );
  if (sessionID === undefined) {
    throw new Error("honk: this thread has no sidekick session yet; delegate a task first.");
  }
  return sessionID;
}

function partLine(part: Readonly<Record<string, unknown>>): string | null {
  if (part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0) {
    return clipped(part.text.trim(), STATUS_PART_LIMIT);
  }
  if (part.type !== "tool" || typeof part.tool !== "string") return null;
  const state = part.state;
  if (typeof state !== "object" || state === null) return `[tool ${part.tool}]`;
  const status = Reflect.get(state, "status");
  const title = Reflect.get(state, "title");
  const suffix = typeof title === "string" && title.length > 0 ? `: ${title}` : "";
  return `[tool ${part.tool} — ${typeof status === "string" ? status : "unknown"}${clipped(suffix, STATUS_PART_LIMIT)}]`;
}

function clipped(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}
