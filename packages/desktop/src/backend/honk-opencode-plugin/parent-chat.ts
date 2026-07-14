import type {
  PluginInput,
  PluginMessageGroup,
  PluginSession,
  ToolDefinition,
  ToolResult,
} from "./types";

const SIDE_CHAT_METADATA_KEY = "honkSideChat";
const PARENT_CHAT_OUTPUT_LIMIT = 24_000;
const PARENT_CHAT_PART_LIMIT = 2_000;

function sideChatParentId(session: PluginSession): string | null {
  const raw = session.metadata?.[SIDE_CHAT_METADATA_KEY];
  if (typeof raw !== "object" || raw === null) return null;
  const parentThreadId = Reflect.get(raw, "parentThreadId");
  return typeof parentThreadId === "string" && parentThreadId.length > 0 ? parentThreadId : null;
}

function clipped(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

function partTranscript(part: Readonly<Record<string, unknown>>): string | null {
  if (part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0) {
    return part.text.trim();
  }
  if (part.type !== "tool" || typeof part.tool !== "string") return null;

  const state = part.state;
  if (typeof state !== "object" || state === null) return `[tool ${part.tool}]`;
  const output = Reflect.get(state, "output");
  return typeof output === "string" && output.trim().length > 0
    ? `[tool ${part.tool}] ${clipped(output.trim(), PARENT_CHAT_PART_LIMIT)}`
    : `[tool ${part.tool}]`;
}

function messageTranscript(group: PluginMessageGroup): string | null {
  const content = group.parts
    .map(partTranscript)
    .filter((part): part is string => part !== null)
    .join("\n");
  return content.length > 0 ? `${group.info.role}: ${content}` : null;
}

function parentChatQuery(args: unknown): string {
  if (typeof args !== "object" || args === null) return "";
  const query = Reflect.get(args, "query");
  return typeof query === "string" ? query.trim().toLowerCase() : "";
}

export function createParentChatTool(plugin: PluginInput): ToolDefinition {
  return {
    description:
      "Reads the current parent conversation for this side chat. The side chat already contains the parent snapshot from when it was created; use this only when you need parent messages added since then, or to search the current parent transcript. Pass an empty query for the latest transcript.",
    args: {
      query: {
        type: "string",
        description: "Case-insensitive transcript search, or an empty string for recent messages.",
      },
    },
    async execute(args, context): Promise<ToolResult> {
      const currentResult = await plugin.client.session.get({
        path: { id: context.sessionID },
        query: { directory: plugin.directory },
      });
      if (currentResult.data === undefined) {
        throw new Error("honk: failed to read the current side chat session.");
      }

      const parentThreadId = sideChatParentId(currentResult.data);
      if (parentThreadId === null) {
        throw new Error("honk: parent_chat is only available inside a side chat.");
      }

      const messagesResult = await plugin.client.session.messages({
        path: { id: parentThreadId },
        query: { directory: plugin.directory },
      });
      if (messagesResult.data === undefined) {
        throw new Error("honk: failed to read the parent chat transcript.");
      }

      const query = parentChatQuery(args);
      const transcript = messagesResult.data
        .map(messageTranscript)
        .filter((message): message is string => message !== null)
        .filter((message) => query.length === 0 || message.toLowerCase().includes(query));
      const output =
        transcript.length > 0
          ? clipped(transcript.join("\n\n"), PARENT_CHAT_OUTPUT_LIMIT)
          : query.length > 0
            ? `No parent chat messages matched "${query}".`
            : "The parent chat has no transcript messages yet.";
      return { title: "Parent chat", output };
    },
  };
}
