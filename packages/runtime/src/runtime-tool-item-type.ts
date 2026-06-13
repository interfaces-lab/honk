import type { ToolLifecycleItemType } from "@honk/contracts";

export function runtimeToolItemTypeForName(toolName: string): ToolLifecycleItemType {
  switch (toolName) {
    case "bash":
    case "shell":
      return "command_execution";
    case "read":
      return "file_read";
    case "grep":
    case "find":
    case "ls":
      return "file_search";
    case "edit":
    case "write":
      return "file_change";
    case "subagent":
      return "collab_agent_tool_call";
    default:
      return "dynamic_tool_call";
  }
}
